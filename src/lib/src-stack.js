const cdk = require("aws-cdk-lib");
const apigateway = require("aws-cdk-lib/aws-apigateway");
const lambda = require("aws-cdk-lib/aws-lambda");
const dynamodb = require("aws-cdk-lib/aws-dynamodb");
const pipes = require("aws-cdk-lib/aws-pipes");
const events = require("aws-cdk-lib/aws-events");
const targets = require("aws-cdk-lib/aws-events-targets");
const logs = require("aws-cdk-lib/aws-logs");
const iam = require("aws-cdk-lib/aws-iam");
const sqs = require("aws-cdk-lib/aws-sqs");
const stepfunctions = require("aws-cdk-lib/aws-stepfunctions");
const tasks = require("aws-cdk-lib/aws-stepfunctions-tasks");
const sns = require("aws-cdk-lib/aws-sns");
const snsSubscriptions = require("aws-cdk-lib/aws-sns-subscriptions");
const path = require("path");
const { NodejsFunction } = require("aws-cdk-lib/aws-lambda-nodejs");

class AirLankaVAS extends cdk.Stack {
  constructor(scope, id, props) {
    super(scope, id, props);

    // --------- EventBridge Pipe Source: DynamoDB Table -----------
    const table = new dynamodb.Table(this, "OrdersTable", {
      partitionKey: { name: "orderId", type: dynamodb.AttributeType.STRING },
      stream: dynamodb.StreamViewType.NEW_IMAGE,
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // -------------  Lambda behind the API Gateway ----------------
    const apiLambda = new NodejsFunction(this, "ApiLambda", {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: "index.handler",
      entry: path.join(__dirname, "../lambda/api/index.js"),
      bundling: {
        minify: true,
        sourceMap: true,
      },
      environment: {
        ORDERS_TABLE_NAME: table.tableName,
      },
    });
    table.grantWriteData(apiLambda);

    // -------------------- API Gateway ----------------------------
    const api = new apigateway.LambdaRestApi(this, "AirLankaVASApi", {
      handler: apiLambda,
      proxy: false,
    });
    api.root.addResource("order").addMethod("POST");

    // ------------------- EventBridge Pipe Log Group --------------
    const pipeLogGroup = new logs.LogGroup(this, "EventBridgePipeLogGroup", {
      retention: logs.RetentionDays.ONE_DAY,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // ------------------- EventBridge Pipe DLQ---------------------
    const dlq = new sqs.Queue(this, "OrderEventsDLQ", {
      retentionPeriod: cdk.Duration.days(14),
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // ------------ EventBridge Pipe Enrichment Lambda --------------
    const enrichmentLambda = new NodejsFunction(this, "EnrichmentLambda", {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: "index.handler",
      entry: path.join(__dirname, "../lambda/enrichment/index.js"),
      bundling: {
        minify: true,
        sourceMap: true,
      },
      environment: {
        ORDERS_TABLE_NAME: table.tableName,
      },
    });
    table.grantReadData(enrichmentLambda);

    // ------------ EventBridge Pipe Target: Event Bus ---------------
    const eventBus = new events.EventBus(this, "OrderEventBus", {
      eventBusName: "OrderEventsBus",
    });

    // ---------------- EventBridge Pipe IAM Role --------------------
    const pipeRole = new iam.Role(this, "EventBridgePipeRole", {
      assumedBy: new iam.ServicePrincipal("pipes.amazonaws.com"),
    });
    table.grantStreamRead(pipeRole);
    eventBus.grantPutEventsTo(pipeRole);
    pipeLogGroup.grantWrite(pipeRole);
    dlq.grantSendMessages(pipeRole);
    enrichmentLambda.grantInvoke(pipeRole);

    // -------------------- EventBridge Pipe -----------------------------
    new pipes.CfnPipe(this, "DynamoDBToEventBridgePipe", {
      name: "OrdersPipe",
      roleArn: pipeRole.roleArn,
      source: table.tableStreamArn,
      sourceParameters: {
        dynamoDbStreamParameters: {
          startingPosition: "LATEST",
          batchSize: 10,
          maximumRetryAttempts: 0,
          deadLetterConfig: {
            arn: dlq.queueArn,
          },
        },
        filterCriteria: {
          filters: [
            {
              pattern: JSON.stringify({
                eventName: ["INSERT"],
              }),
            },
          ],
        },
      },
      target: eventBus.eventBusArn,
      targetParameters: {
        eventBridgeEventBusParameters: {
          detailType: "order-created",
          source: "AirLankaVAS.orders",
        },
      },
      enrichment: enrichmentLambda.functionArn,
      logConfiguration: {
        level: "ERROR",
        cloudwatchLogsLogDestination: {
          logGroupArn: pipeLogGroup.logGroupArn,
        },
      },
    });

    // -------------- Event Bus Target: CloudWatch Log Group -------------
    const catchAllTargetLogGroup = new logs.LogGroup(
      this,
      "EventBridgeLogGroup",
      {
        removalPolicy: cdk.RemovalPolicy.DESTROY,
        retention: logs.RetentionDays.ONE_DAY,
      }
    );

    // ----------- Event Bus Rule: CloudWatch Log Group Rule -------------
    new events.Rule(this, "LogAllEventsRule", {
      eventBus: eventBus,
      eventPattern: {
        source: events.Match.prefix(""),
      },
      targets: [new targets.CloudWatchLogGroup(catchAllTargetLogGroup)],
    });

    // --------------- Step Function: Pass State -------------------------
    const passState = new stepfunctions.Pass(this, "PassState", {
      result: stepfunctions.Result.fromObject({
        message: "Order processing initiated",
      }),
      resultPath: "$.passStateResult",
    });

    // ------------------ Step Function: Lambda Function -----------------
    const processOrderLambda = new NodejsFunction(this, "ProcessOrderLambda", {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: "index.handler",
      entry: path.join(__dirname, "../lambda/process-order/index.js"),
      bundling: {
        minify: true,
        sourceMap: true,
      },
      environment: {
        EVENT_BUS_NAME: eventBus.eventBusName,
      },
    });
    eventBus.grantPutEventsTo(processOrderLambda);

    // ---------------- Step Function: Lambda Invoke Step ----------------
    const processOrderStep = new tasks.LambdaInvoke(this, "ProcessOrderStep", {
      lambdaFunction: processOrderLambda,
      payload: stepfunctions.TaskInput.fromJsonPathAt("$"),
      resultPath: "$.processOrderResult",
    });

    // ---------------- Event Bus Target: Step Function Workflow ----------
    const orderProcessingWorkflow = new stepfunctions.StateMachine(
      this,
      "OrderProcessingWorkflow",
      {
        definitionBody: stepfunctions.DefinitionBody.fromChainable(
          passState.next(processOrderStep)
        ),
        timeout: cdk.Duration.minutes(5),
        tracingEnabled: true,
      }
    );

    // ----------------------- Event Bus: IAM Role ------------------------
    const eventBridgeRole = new iam.Role(this, "EventBridgeRole", {
      assumedBy: new iam.ServicePrincipal("events.amazonaws.com"),
    });
    orderProcessingWorkflow.grantStartExecution(eventBridgeRole);

    // ------------ Event Bus Rule: Step Function --------------------------
    new events.Rule(this, "OrderCreatedRule", {
      eventBus: eventBus,
      eventPattern: {
        source: ["AirLankaVAS.orders"],
        detailType: ["order-created"],
      },
      targets: [
        new targets.SfnStateMachine(orderProcessingWorkflow, {
          role: eventBridgeRole,
          input: events.RuleTargetInput.fromObject({
            orderId: events.EventField.fromPath("$.detail.orderId"),
            passengerId: events.EventField.fromPath("$.detail.passengerId"),
            passengerName: events.EventField.fromPath("$.detail.passengerName"),
            email: events.EventField.fromPath("$.detail.email"),
            notificationChannel: events.EventField.fromPath(
              "$.detail.notificationChannel"
            ),
            flightId: events.EventField.fromPath("$.detail.flightId"),
            flightDetails: events.EventField.fromPath("$.detail.flightDetails"),
            items: events.EventField.fromPath("$.detail.items"),
          }),
        }),
      ],
    });

    // ----------------- Event Bus Target: SNS Topic -----------------------
    let notificationTopic = new sns.Topic(this, "OrderNotificationTopic", {
      displayName: "Order Notification Topic",
      topicName: "OrderNotificationTopic",
    });

    // ------------------- Event Bus Rule: SNS Topic -----------------------
    // new events.Rule(this, "OrderCompleteEmailNotificationRule", {
    //   eventBus: eventBus,
    //   eventPattern: {
    //     source: ["AirLankaVAS.orders"],
    //     detailType: ["order-complete"],
    //     detail: {
    //       notificationChannel: ["EMAIL"],
    //     },
    //   },
    //   targets: [
    //     new targets.SnsTopic(notificationTopic, {
    //       message: events.RuleTargetInput.fromObject({
    //         subject: "Order Complete Notification",
    //         message: events.EventField.fromPath("$.detail"),
    //       }),
    //     }),
    //   ],
    // });

    // ----------------------- Event Bus Target: SQS Queue -----------------
    
    const loyaltyPointsQueue = new sqs.Queue(this, "LoyaltyPointsQueue", {
      queueName: "LoyaltyPointsQueue",
      retentionPeriod: cdk.Duration.days(10),
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // ------------------- Event Bus Rule: SQS Queue -----------------------
    new events.Rule(this, "OrderCompleteLoyaltyPointsRule", {
      eventBus: eventBus,
      eventPattern: {
        source: ["AirLankaVAS.orders"],
        detailType: ["order-complete"],
        detail: {
          notificationChannel: ["EMAIL", "SMS"],
        },
      },
      targets: [
        new targets.SqsQueue(loyaltyPointsQueue, {
          message: events.RuleTargetInput.fromObject({
            detailType: events.EventField.fromPath("$.detailType"),
            notificationChannel: events.EventField.fromPath(
              "$.detail.notificationChannel"
            ),
            orderId: events.EventField.fromPath("$.detail.orderId"),
            passengerId: events.EventField.fromPath("$.detail.passengerId"),
            passengerName: events.EventField.fromPath("$.detail.passengerName"),
            email: events.EventField.fromPath("$.detail.email"),
            flightId: events.EventField.fromPath("$.detail.flightId"),
            flightDetails: events.EventField.fromPath("$.detail.flightDetails"),
            items: events.EventField.fromPath("$.detail.items"),
          }),
        }),
      ],
    });

    // Lambda function to notify
    const notifyLambda = new NodejsFunction(this, "NotifyLambdaLambda", {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: "index.handler",
      entry: path.join(__dirname, "../lambda/notify/index.js"),
      bundling: {
        minify: true,
        sourceMap: true,
      },
    });

    const schedulerRole = new iam.Role(this, "SchedulerInvokeLambdaRole", {
      assumedBy: new iam.ServicePrincipal("scheduler.amazonaws.com")
    });
    // Grant permission to the notifyLambda
    notifyLambda.grantInvoke(schedulerRole);

    const schedulingLambdaRole = new iam.Role(this, "SchedulerLambdaRole", {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          "service-role/AWSLambdaBasicExecutionRole"
        ),
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          "AmazonEventBridgeSchedulerFullAccess"
        ),
      ],
    });

    // Create the DLQ for Scheduler
    const schedulerDLQ = new sqs.Queue(this, "SchedulerDLQ", {
      queueName: "SchedulerDLQ",
      retentionPeriod: cdk.Duration.days(14), // Retain messages for up to 14 days
    });
    // Grant permission for EventBridge Scheduler to send messages to the DLQ
    schedulerDLQ.grantSendMessages(
      new iam.ServicePrincipal("scheduler.amazonaws.com")
    );

    // Lambda function to handle SNS messages and schedule EventBridge events
    const schedulingLambda = new NodejsFunction(this, "ScheduleEventLambda", {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: "index.handler",
      entry: path.join(__dirname, "../lambda/schedule-event/index.js"),
      bundling: {
        minify: true,
        sourceMap: true,
      },
      environment: {
        SCHEDULER_ROLE_ARN: schedulerRole.roleArn,
        NOTIFY_LAMBDA_ARN: notifyLambda.functionArn,
        SCHEDULER_DLQ_ARN: schedulerDLQ.queueArn,
      },
      role: schedulingLambdaRole,
    });

    // ------------------- Event Bus Rule: Schedule Notification Rule -----------------------
    new events.Rule(this, "ScheduleNotificationRule", {
      eventBus: eventBus,
      eventPattern: {
        source: ["AirLankaVAS.orders"],
        detailType: ["order-complete"],
        detail: {
          notificationChannel: ["EMAIL", "SMS"],
        },
      },
      targets: [
        new targets.LambdaFunction(schedulingLambda, {
          event: events.RuleTargetInput.fromObject({
            detailType: events.EventField.fromPath("$.detailType"),
            notificationChannel: events.EventField.fromPath(
              "$.detail.notificationChannel"
            ),
            orderId: events.EventField.fromPath("$.detail.orderId"),
            passengerId: events.EventField.fromPath("$.detail.passengerId"),
            passengerName: events.EventField.fromPath("$.detail.passengerName"),
            email: events.EventField.fromPath("$.detail.email"),
            flightId: events.EventField.fromPath("$.detail.flightId"),
            flightDetails: events.EventField.fromPath("$.detail.flightDetails"),
            items: events.EventField.fromPath("$.detail.items"),
          }),
        }),
      ],
    });

    // ----------------------------- Outputs --------------------------------
    new cdk.CfnOutput(this, "ApiGatewayUrl", {
      value: api.url,
      description: "The URL of the AirLankaVAS API Gateway",
      exportName: "AirLankaVASApiGatewayUrl",
    });
  }
}

module.exports = { AirLankaVAS };
