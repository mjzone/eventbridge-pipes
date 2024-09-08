const { unmarshall } = require("@aws-sdk/util-dynamodb");

exports.handler = async (event) => {
  console.log("Received batch of events:", JSON.stringify(event, null, 2));

  const enrichedEvents = event.map((record) => {
    const newItem = unmarshall(record.dynamodb.NewImage);

    console.log(
      "Unmarshalled DynamoDB item:",
      JSON.stringify(newItem, null, 2)
    );

    return {
      orderId: newItem.orderId,
      passengerId: newItem.passengerId,
      passengerName: newItem.passengerName,
      email: newItem.email,
      items: newItem.items,
      flightDetails: newItem.flightDetails,
      enrichedAttribute: "This is an enriched value",
      enrichmentTimestamp: new Date().toISOString(),
    };
  });

  console.log("Enriched events:", JSON.stringify(enrichedEvents, null, 2));

  return enrichedEvents;
};
