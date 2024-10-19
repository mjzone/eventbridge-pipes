const { SchedulerClient, CreateScheduleCommand } = require("@aws-sdk/client-scheduler");
const crypto = require("crypto");
const client = new SchedulerClient();

exports.handler = async (event) => {
  console.log(JSON.stringify(event));
  const scheduleName = crypto.randomUUID();

  // Schedule the event 1 minutes in the future
  const timeToSchedule = new Date(Date.now() + (1 * 60) * 1000);

  // Format the date as 'yyyy-mm-ddThh:mm:ss'
  const formattedTimeToSchedule = timeToSchedule.toISOString().split('.')[0]; // Removes milliseconds

  console.log(`Scheduling at: ${formattedTimeToSchedule}`);

  const params = {
    Name: scheduleName,
    ScheduleExpression: `at(${formattedTimeToSchedule})`, //at(yyyy-mm-ddThh:mm:ss)
    FlexibleTimeWindow: {
      Mode: "OFF",
    },
    Target: {
      Arn: process.env.NOTIFY_LAMBDA_ARN,
      RoleArn: process.env.SCHEDULER_ROLE_ARN,
      Input: JSON.stringify(event),
      DeadLetterConfig: {
        Arn: process.env.SCHEDULER_DLQ_ARN
      },
      RetryPolicy: {
        MaximumEventAgeInSeconds: 3600,
        MaximumRetryAttempts: 1
      }
    },
    ActionAfterCompletion: "DELETE"
  };

  try {
    const command = new CreateScheduleCommand(params);
    await client.send(command);
    console.log(`Successfully scheduled event with name: ${scheduleName}`);
  } catch (error) {
    console.error(`Failed to schedule event: ${error.message}`);
  }
};
