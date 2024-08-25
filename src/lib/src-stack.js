const { Stack, Duration } = require('aws-cdk-lib');
const dynamodb = require('aws-cdk-lib/aws-dynamodb');
const lambda = require('aws-cdk-lib/aws-lambda');
const apigateway = require('aws-cdk-lib/aws-apigateway');

class SrcStack extends Stack {
  /**
   *
   * @param {Construct} scope
   * @param {string} id
   * @param {StackProps=} props
   */
  constructor(scope, id, props) {
    super(scope, id, props);

     // Orders DynamoDB table
     const table = new dynamodb.Table(this, 'OrdersTable', {
      partitionKey: { name: 'orderId', type: dynamodb.AttributeType.STRING },
      stream: dynamodb.StreamViewType.NEW_IMAGE,
    });

    // Lambda function
    const apiLambda = new lambda.Function(this, 'ApiLambda', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'api.handler',
      code: lambda.Code.fromAsset('lambda'),
    });
    table.grantWriteData(apiLambda);

    const api = new apigateway.LambdaRestApi(this, 'ECommerceApi', {
      handler: apiLambda,
      proxy: false
    });
    api.root.addResource('order').addMethod('POST');

  }
}

module.exports = { SrcStack }
