const { Stack, Duration } = require('aws-cdk-lib');
const dynamodb = require('aws-cdk-lib/aws-dynamodb');
const lambda = require('aws-cdk-lib/aws-lambda');
const { NodejsFunction } = require('aws-cdk-lib/aws-lambda-nodejs');
const apigateway = require('aws-cdk-lib/aws-apigateway');
const path = require('path');

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
     const table = new dynamodb.Table(this, 'OrdersTable', {
      partitionKey: { name: 'orderId', type: dynamodb.AttributeType.STRING },
      stream: dynamodb.StreamViewType.NEW_IMAGE,
    });

    // Lambda Function
    const apiLambda = new NodejsFunction(this, 'ApiLambda', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      entry: path.join(__dirname, '../lambda/api/index.js'),
      bundling: {
        minify: false,
        sourceMap: false,
      },
      environment: {
        ORDERS_TABLE_NAME: table.tableName,
        STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY || "super-secret",
      },
    });
    table.grantWriteData(apiLambda);
    

    // API Gateway 
    const api = new apigateway.LambdaRestApi(this, 'ECommerceApi', {
      handler: apiLambda,
      proxy: false
    });
    api.root.addResource('order').addMethod('POST');

  }
}

module.exports = { SrcStack }
