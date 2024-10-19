import {
  EventBridgeClient,
  PutEventsCommand,
} from "@aws-sdk/client-eventbridge";

const eventBridgeClient = new EventBridgeClient();

export const handler = async (event) => {
  console.log("Order processed successfully", event);
  // calling stripe to charge the customer
  // do other stuff related to the order

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
    await eventBridgeClient.send(new PutEventsCommand(params));
    console.log("Event published successfully");
    return "Order processed and event published successfully";
  } catch (error) {
    console.error("Failed to publish event", error);
    return "Failed to process the order and publish event";
  }
};
