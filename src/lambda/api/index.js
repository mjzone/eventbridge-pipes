exports.handler = async function (event) {
  console.log("Received event");

  // Extract order data from the request
  const order = JSON.parse(event.body);

  // Add order processing logic here
  // For example, store the order in a database, process payment, etc.

  // Return a success response
  return {
    statusCode: 200,
    body: JSON.stringify({
      message: "Order received successfully",
      orderId: order.orderId,
    }),
  };
};
