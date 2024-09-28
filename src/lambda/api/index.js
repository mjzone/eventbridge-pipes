import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import { randomUUID } from "crypto";

const client = new DynamoDBClient({});
const dynamoDb = DynamoDBDocumentClient.from(client);

const TABLE_NAME = process.env.ORDERS_TABLE_NAME;

export const handler = async (event) => {
  try {
    const body = JSON.parse(event.body);

    // Generate a new orderId
    const orderId = randomUUID();

    // Create the order item
    const order = {
      orderId: orderId,
      passengerId: body?.passengerId,
      passengerName: body?.passengerName || "",
      email: body?.email || "",
      flightDetails: body?.flightDetails || {},
      totalAmount: body?.totalAmount,
      items: body?.items || [],
      notificationChannel: body?.notificationChannel || "EMAIL",
      paymentStatus: "succeeded",
      stripePaymentId: body?.stripePaymentId,
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
