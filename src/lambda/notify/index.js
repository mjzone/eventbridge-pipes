exports.handler = async (event) => {
  console.log("Scheduled event received:", JSON.stringify(event));
  console.log("Notification sent!");

  return {
    statusCode: 200,
    body: JSON.stringify("Notification sent!"),
  };
};
