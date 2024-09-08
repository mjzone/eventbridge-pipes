exports.handler = async (event) => {
  console.log("Received batch of events:", JSON.stringify(event, null, 2));

  // Enrich each event in the batch
  const enrichedEvents = event.map((order) => {
    return {
      ...order,
      enrichedAttribute: "This is an enriched value",
      enrichmentTimestamp: new Date().toISOString(),
    };
  });

  console.log("Enriched events:", JSON.stringify(enrichedEvents, null, 2));

  return enrichedEvents;
};
