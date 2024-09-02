const { Stack } = require("aws-cdk-lib");
const dynamodb = require("aws-cdk-lib/aws-dynamodb");
const lambda = require("aws-cdk-lib/aws-lambda");
const { NodejsFunction } = require("aws-cdk-lib/aws-lambda-nodejs");
const apigateway = require("aws-cdk-lib/aws-apigateway");
const { EventBus, Rule } = require("aws-cdk-lib/aws-events");
const { CfnPipe } = require("aws-cdk-lib/aws-pipes");
const { LogGroup } = require("aws-cdk-lib/aws-logs");
const { CloudWatchLogGroup } = require("aws-cdk-lib/aws-events-targets");
const {
  Role,
  ServicePrincipal,
  PolicyStatement,
} = require("aws-cdk-lib/aws-iam");
const path = require("path");

class SrcStack extends Stack {
  /**
   *
   * @param {Construct} scope
   * @param {string} id
   * @param {StackProps=} props
   */
  constructor(scope, id, props) {
    super(scope, id, props);

    // Orders DynamoDB Table
    const table = new dynamodb.Table(this, "OrdersTable", {
      partitionKey: { name: "orderId", type: dynamodb.AttributeType.STRING },
      stream: dynamodb.StreamViewType.NEW_IMAGE,
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
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
    table.grantWriteData(apiLambda);

    // API Gateway
    const api = new apigateway.LambdaRestApi(this, "ECommerceApi", {
      handler: apiLambda,
      proxy: false,
    });
    api.root.addResource("order").addMethod("POST");

    // EventBridge event bus
    const eventBus = new EventBus(this, "OrderEventsBus", {
      eventBusName: "OrderEventsBus",
    });

    // Create a CloudWatch Log Group for EventBridge Pipe logs
    const pipeLogGroup = new LogGroup(this, "EventBridgePipeLogGroup");

    // IAM Role for EventBridge Pipe
    const pipeRole = new Role(this, "EventBridgePipeRole", {
      assumedBy: new ServicePrincipal("pipes.amazonaws.com"),
    });

    // Grant necessary permissions to the EventBridge Pipe Role
    pipeRole.addToPolicy(
      new PolicyStatement({
        actions: [
          "dynamodb:DescribeStream",
          "dynamodb:GetRecords",
          "dynamodb:GetShardIterator",
          "dynamodb:ListStreams",
        ],
        resources: [table.tableStreamArn],
      })
    );

    pipeRole.addToPolicy(
      new PolicyStatement({
        actions: ["events:PutEvents"],
        resources: [eventBus.eventBusArn],
      })
    );

    pipeRole.addToPolicy(
      new PolicyStatement({
        actions: ["logs:CreateLogStream", "logs:PutLogEvents"],
        resources: [pipeLogGroup.logGroupArn],
      })
    );

    // EventBridge Pipe to route DynamoDB stream INSERT events to EventBridge using CfnPipe
    new CfnPipe(this, "DynamoDBToEventBridgePipe", {
      name: "OrdersPipe",
      roleArn: pipeRole.roleArn,
      source: table.tableStreamArn,
      sourceParameters: {
        dynamoDbStreamParameters: {
          startingPosition: "LATEST",
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
          source: "mjstore.orders"
        },
        inputTemplate: JSON.stringify({
          orderId: "<$.dynamodb.NewImage.orderId.S>",
          passengerId: "<$.dynamodb.NewImage.passengerId.S>",
          passengerName: "<$.dynamodb.NewImage.passengerName.S>",
          email: "<$.dynamodb.NewImage.email.S>",
          flightId: "<$.dynamodb.NewImage.flightId.S>",
          flightDetails: "<$.dynamodb.NewImage.flightDetails.M>",
          items: "<$.dynamodb.NewImage.items.L>",
          metadata: {
            status: "order-created",
            createdAt: "$$.Timestamp",
          }
        })
      },
      loggingConfig: {
        cloudWatchLogGroupArn: pipeLogGroup.logGroupArn,
      },
    });

    // Create a CloudWatch Log Group
    const logGroup = new LogGroup(this, "EventBridgeLogGroup");

    // IAM Role for EventBridge Rule to log to CloudWatch
    const eventBridgeRuleRole = new Role(this, "EventBridgeRuleRole", {
      assumedBy: new ServicePrincipal("events.amazonaws.com"),
    });

    eventBridgeRuleRole.addToPolicy(
      new PolicyStatement({
        actions: ["logs:CreateLogStream", "logs:PutLogEvents"],
        resources: [logGroup.logGroupArn],
      })
    );

    // Create an EventBridge Rule to log all events
    new Rule(this, "LogAllEventsRule", {
      eventBus: eventBus,
      eventPattern: {
        source: [{ exists: true }],
        "detail-type": [{ exists: true }],
      },
      targets: [
        new CloudWatchLogGroup(logGroup, {
          role: eventBridgeRuleRole,
        }),
      ],
    });
  }
}

module.exports = { SrcStack };
