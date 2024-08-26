import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import { randomUUID } from "crypto";

const client = new DynamoDBClient({});
const dynamoDb = DynamoDBDocumentClient.from(client);

const TABLE_NAME = process.env.ORDERS_TABLE_NAME;

export const handler = async (event) => {
  try {
    // Parse the JSON body from the request
    const body = JSON.parse(event.body);

    // Validate the required fields
    if (
      !body.passengerId ||
      !body.flightId ||
      !body.totalAmount ||
      !body.stripePaymentId
    ) {
      return {
        statusCode: 400,
        body: JSON.stringify({ message: "Missing required fields" }),
      };
    }
    console.log("Payment Validation Successful!");

    // Generate a new orderId
    const orderId = randomUUID();

    // Create the order item
    const order = {
      orderId: orderId,
      passengerId: body?.passengerId,
      passengerName: body?.passengerName || "N/A",
      email: body?.email || "N/A",
      flightId: body?.flightId,
      flightDetails: body?.flightDetails || {},
      totalAmount: body?.totalAmount,
      paymentStatus: "succeeded",
      stripePaymentId: body?.stripePaymentId,
      items: body?.items || [],
      createdAt: new Date().toISOString(),
    };

    // Store the order in DynamoDB using the PutCommand
    await dynamoDb.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: order,
      })
    );

    // Return success response
    return {
      statusCode: 201,
      body: JSON.stringify({
        message: "Order created successfully",
        orderId: orderId,
      }),
    };
  } catch (error) {
    console.error("Error creating order:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ message: "Internal server error" }),
    };
  }
};
