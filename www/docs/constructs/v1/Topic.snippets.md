### Configuring subscribers

#### Lazily adding subscribers

Add subscribers after the topic has been created.

```js {8-10}
const topic = new Topic(this, "Topic", {
  subscribers: {
    subscriber1: "src/subscriber1.main",
    subscriber2: "src/subscriber2.main",
  },
});

topic.addSubscribers(this, {
  subscriber3: "src/subscriber3.main",
});
```

### Configuring Function subscribers

#### Specifying function props for all the subscribers

You can extend the minimal config, to set some function props and have them apply to all the subscribers.

```js {3-7}
new Topic(this, "Topic", {
  defaults: {
    function: {
      timeout: 20,
      environment: { tableName: table.tableName },
      permissions: [table],
    },
  },
  subscribers: {
    subscriber1: "src/subscriber1.main",
    subscriber2: "src/subscriber2.main",
  },
});
```

#### Configuring an individual subscriber

Configure each Lambda function separately.

```js
new Topic(this, "Topic", {
  subscribers: {
    subscriber: {
      function: {
        srcPath: "src/",
        handler: "subscriber1.main",
        environment: { tableName: table.tableName },
        permissions: [table],
      },
    },
  },
});
```

Note that, you can set the `defaultFunctionProps` while using the `function` per subscriber. The `function` will just override the `defaultFunctionProps`. Except for the `environment`, the `layers`, and the `permissions` properties, that will be merged.

```js
new Topic(this, "Topic", {
  defaults: {
    function: {
      timeout: 20,
      environment: { tableName: table.tableName },
      permissions: [table],
    },
  },
  subscribers: {
    subscriber1: {
      function: {
        handler: "subscriber1.main",
        timeout: 10,
        environment: { bucketName: bucket.bucketName },
        permissions: [bucket],
      },
    },
    subscriber2: "subscriber2.main",
  },
});
```

So in the above example, the `subscriber1` function doesn't use the `timeout` that is set in the `defaultFunctionProps`. It'll instead use the one that is defined in the function definition (`10 seconds`). And the function will have both the `tableName` and the `bucketName` environment variables set; as well as permissions to both the `table` and the `bucket`.

#### Giving the subscribers some permissions

Allow the subscriber functions to access S3.

```js {8}
const topic = new Topic(this, "Topic", {
  subscribers: {
    subscriber1: "src/subscriber1.main",
    subscriber2: "src/subscriber2.main",
  },
});

topic.attachPermissions(["s3"]);
```

#### Giving a specific subscriber some permissions

Allow the first subscriber function to access S3.

```js {8}
const topic = new Topic(this, "Topic", {
  subscribers: {
    subscriber1: "src/subscriber1.main",
    subscriber2: "src/subscriber2.main",
  },
});

topic.attachPermissionsToSubscriber("subscriber1", ["s3"]);
```

#### Configuring the subscription

Configure the internally created CDK `Subscription`.

```js {8-14}
import { SubscriptionFilter } from "aws-cdk-lib/aws-sns";

new Topic(this, "Topic", {
  subscribers: {
    subscriber1: {
      function: "src/subscriber1.main",
      cdk: {
        subscription: {
          filterPolicy: {
            color: SubscriptionFilter.stringFilter({
              allowlist: ["red"],
            }),
          },
        },
      },
    },
  },
});
```

### Configuring Queue subscribers

#### Specifying the Queue directly

You can directly pass in an instance of the Queue construct.

```js {5}
const myQueue = new Queue(this, "MyQueue");

new Topic(this, "Topic", {
  subscribers: {
    subscriber: myQueue
  },
});
```

#### Configuring the subscription

Configure the internally created CDK `Subscription`.

```js {10-16}
import { SubscriptionFilter } from "aws-cdk-lib/aws-sns";

const myQueue = new Queue(this, "MyQueue");

new Topic(this, "Topic", {
  subscribers: {
    subscriber: {
      queue: myQueue,
      cdk: {
        subscription: {
          filterPolicy: {
            color: SubscriptionFilter.stringFilter({
              allowlist: ["red"],
            }),
          },
        },
      },
    },
  },
});
```

### FIFO topic

```js {7-9}
new Topic(this, "Topic", {
  subscribers: {
    subscriber1: "src/subscriber1.main",
    subscriber2: "src/subscriber2.main",
  },
  cdk: {
    topic: {
      fifo: true,
    },
  },
});
```

### Advanced examples

#### Configuring the SNS Topic

Configure the internally created CDK `Topic` instance.

```js {7-9}
new Topic(this, "Topic", {
  subscribers: {
    subscriber1: "src/subscriber1.main",
    subscriber2: "src/subscriber2.main",
  },
  cdk: {
    topic: {
      topicName: "my-topic",
    },
  },
});
```

#### Importing an existing Topic

Override the internally created CDK `Topic` instance.

```js {9}
import * as sns from "aws-cdk-lib/aws-sns";

new Topic(this, "Topic", {
  subscribers: {
    subscriber1: "src/subscriber1.main",
    subscriber2: "src/subscriber2.main",
  },
  cdk: {
    topic: sns.Topic.fromTopicArn(this, "MySnsTopic", topicArn),
  },
});
```
