import {
  EventBridgeClient,
  PutEventsCommand,
} from "@aws-sdk/client-eventbridge";

const eventBridgeClient = new EventBridgeClient();

export const handler = async (event) => {
  console.log("Order processed successfully", event);

  const params = {
    Entries: [
      {
        EventBusName: process.env.EVENT_BUS_NAME,
        Source: "AirLankaVAS.orders",
        DetailType: "order-complete",
        Detail: JSON.stringify(event),
      },
    ],
  };

  try {
    const result = await eventBridgeClient.send(new PutEventsCommand(params));
    console.log("Event published successfully", result);

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: "Order processed and event published successfully",
      }),
    };
  } catch (error) {
    console.error("Failed to publish event", error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        message: "Failed to process the order and publish event",
      }),
    };
  }
};
