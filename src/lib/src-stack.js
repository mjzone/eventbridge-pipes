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
const path = require("path");
const { NodejsFunction } = require("aws-cdk-lib/aws-lambda-nodejs");

class AirLankaVAS extends cdk.Stack {
  constructor(scope, id, props) {
    super(scope, id, props);

    // Orders DynamoDB Table
    const table = new dynamodb.Table(this, "OrdersTable", {
      partitionKey: { name: "orderId", type: dynamodb.AttributeType.STRING },
      stream: dynamodb.StreamViewType.NEW_IMAGE,
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Lambda Function
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
    //Allow lambda to write to dynamodb
    table.grantWriteData(apiLambda);

    // API Gateway
    const api = new apigateway.LambdaRestApi(this, "AirLankaVASApi", {
      handler: apiLambda,
      proxy: false,
    });
    api.root.addResource("order").addMethod("POST");

    // EventBridge event bus
    const eventBus = new events.EventBus(this, "OrderEventsBus", {
      eventBusName: "OrderEventsBus",
    });

    // Create a CloudWatch Log Group for EventBridge Pipe logs
    const pipeLogGroup = new logs.LogGroup(this, "EventBridgePipeLogGroup", {
      retention: logs.RetentionDays.ONE_DAY,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Create SQS Queue for DLQ
    const dlq = new sqs.Queue(this, "OrderEventsDLQ", {
      retentionPeriod: cdk.Duration.days(14),
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Enrichment Lambda
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
    // Grant DynamoDB read access to the enrichment Lambda if necessary
    table.grantReadData(enrichmentLambda);

    // IAM Role for EventBridge Pipe
    const pipeRole = new iam.Role(this, "EventBridgePipeRole", {
      assumedBy: new iam.ServicePrincipal("pipes.amazonaws.com"),
    });
    // Allow event bridge pipeRole to read from DynamoDB stream
    table.grantStreamRead(pipeRole);
    // Allow event bridge pipeRole to put events to the event bus
    eventBus.grantPutEventsTo(pipeRole);
    // Allow event bridge pipeRole to write to pipeLogGroup
    pipeLogGroup.grantWrite(pipeRole);
    // Allow event bridge pipeRole to send messages to the DLQ
    dlq.grantSendMessages(pipeRole);
    // Grant permission for the Pipe to invoke the enrichment Lambda function
    enrichmentLambda.grantInvoke(pipeRole);

    // EventBridge Pipe to route DynamoDB stream INSERT events to EventBridge using CfnPipe
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
        inputTemplate: JSON.stringify({
          orderId: "<$.dynamodb.NewImage.orderId.S>",
          passengerId: "<$.dynamodb.NewImage.passengerId.S>",
          passengerName: "<$.dynamodb.NewImage.passengerName.S>",
          email: "<$.dynamodb.NewImage.email.S>",
          flightDetails: {
            flightNumber:
              "<$.dynamodb.NewImage.flightDetails.M.flightNumber.S>",
            from: "<$.dynamodb.NewImage.flightDetails.M.from.S>",
            to: "<$.dynamodb.NewImage.flightDetails.M.to.S>",
          },
        }),
      },
      enrichment: enrichmentLambda.functionArn,
      logConfiguration: {
        level: "ERROR",
        cloudwatchLogsLogDestination: {
          logGroupArn: pipeLogGroup.logGroupArn,
        },
      },
    });

    // Create a CloudWatch Log Group
    const catchAllTargetLogGroup = new logs.LogGroup(
      this,
      "EventBridgeLogGroup",
      {
        removalPolicy: cdk.RemovalPolicy.DESTROY,
        retention: logs.RetentionDays.ONE_DAY,
      }
    );

    // Create an EventBridge Rule to log all events in the catchAllTargetLogGroup
    new events.Rule(this, "LogAllEventsRule", {
      eventBus: eventBus,
      eventPattern: {
        source: events.Match.prefix(""), // match any event source that starts with an empty string
      },
      targets: [new targets.CloudWatchLogGroup(catchAllTargetLogGroup)],
    });
  }
}

module.exports = { AirLankaVAS };
