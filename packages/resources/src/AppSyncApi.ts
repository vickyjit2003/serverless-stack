import * as path from "path";
import * as fs from "fs-extra";
import { print } from "graphql";
import { mergeTypeDefs } from "@graphql-tools/merge";
import { loadFilesSync } from "@graphql-tools/load-files";

import { Construct } from "constructs";
import * as rds from "aws-cdk-lib/aws-rds";
import * as appsync from "@aws-cdk/aws-appsync-alpha";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";

import { App } from "./App";
import { Table } from "./Table";
import { RDS } from "./RDS";
import { getFunctionRef, SSTConstruct, isCDKConstruct } from "./Construct";
import {
  Function as Fn,
  FunctionProps,
  FunctionInlineDefinition,
  FunctionDefinition,
} from "./Function";
import { Permissions } from "./util/permission";

/////////////////////
// Interfaces
/////////////////////

interface AppSyncApiBaseDataSourceProps {
  /**
   * Name of the data source
   */
  name?: string;
  /**
   * Description of the data source
   */
  description?: string;
}

/**
 * Used to define a lambda data source
 *
 * @example
 * ```js
 * new AppSyncApi(stack, "AppSync", {
 *   dataSources: {
 *     lambda: {
 *       type: "function",
 *       function: "src/function.handler"
 *     },
 *   },
 * });
 * ```
 *
 */
export interface AppSyncApiLambdaDataSourceProps
  extends AppSyncApiBaseDataSourceProps {
  /**
   * String literal to signify that this data source is a function
   */
  type?: "function";
  /**
   * Function definition
   */
  function: FunctionDefinition;
}

/**
 * Used to define a lambda data source
 *
 * @example
 * ```js
 * new AppSyncApi(stack, "AppSync", {
 *   dataSources: {
 *     table: {
 *       type: "table",
 *       table: MyTable
 *     },
 *   },
 * });
 * ```
 */
export interface AppSyncApiDynamoDbDataSourceProps
  extends AppSyncApiBaseDataSourceProps {
  /**
   * String literal to signify that this data source is a dynamodb table
   */
  type: "dynamodb";
  /**
   * Target table
   */
  table?: Table;
  cdk?: {
    dataSource?: {
      table: dynamodb.Table;
    };
  };
}

/**
 * Used to define a lambda data source
 *
 * @example
 * ```js
 * new AppSyncApi(stack, "AppSync", {
 *   dataSources: {
 *     rds: {
 *       type: "rds",
 *       rds: MyRDSCluster
 *     },
 *   },
 * });
 * ```
 */
export interface AppSyncApiRdsDataSourceProps
  extends AppSyncApiBaseDataSourceProps {
  /**
   * String literal to signify that this data source is an RDS database
   */
  type: "rds";
  /**
   * Target RDS construct
   */
  rds?: RDS;
  /**
   * The name of the database to connect to
   */
  databaseName?: string;
  cdk?: {
    dataSource?: {
      serverlessCluster: rds.IServerlessCluster;
      secretStore: secretsmanager.ISecret;
      databaseName?: string;
    };
  };
}

/**
 * Used to define an http data source
 *
 * @example
 * ```js
 * new AppSyncApi(stack, "AppSync", {
 *   dataSources: {
 *     http: {
 *       type: "http",
 *       endpoint: "https://example.com"
 *     },
 *   },
 * });
 * ```
 */
export interface AppSyncApiHttpDataSourceProps
  extends AppSyncApiBaseDataSourceProps {
  /**
   * String literal to signify that this data source is an HTTP endpoint
   */
  type: "http";
  /**
   * URL to forward requests to
   */
  endpoint: string;
  cdk?: {
    dataSource?: {
      authorizationConfig?: appsync.AwsIamConfig;
    };
  };
}

export interface MappingTemplateFile {
  /**
   * Path to the file containing the VTL mapping template
   */
  file: string;
}
export interface MappingTemplateInline {
  /**
   * Inline definition of the VTL mapping template
   */
  inline: string;
}

export type MappingTemplate = MappingTemplateFile | MappingTemplateInline;

/**
 * Used to define full resolver config
 */
export interface AppSyncApiResolverProps {
  /**
   * The data source for this resolver. The data source must be already created.
   */
  dataSource?: string;
  /**
   * The function definition used to create the data source for this resolver.
   */
  function?: FunctionDefinition;
  /**
   * VTL request mapping template
   *
   * @example
   * ```js
   *   requestMapping: {
   *     inline: '{"version" : "2017-02-28", "operation" : "Scan"}',
   *   },
   * ```
   *
   * @example
   * ```js
   *   requestMapping: {
   *     file: "path/to/template.vtl",
   *   },
   * ```
   */
  requestMapping?: MappingTemplate;
  /**
   * VTL response mapping template
   *
   * @example
   * ```js
   *   responseMapping: {
   *     inline: "$util.toJson($ctx.result.items)",
   *   },
   * ```
   *
   * @example
   * ```js
   *   responseMapping: {
   *     file: "path/to/template.vtl",
   *   },
   * ```
   */
  responseMapping?: MappingTemplate;
  cdk?: {
    /**
     * This allows you to override the default settings this construct uses internally to create the resolver.
     */
    resolver: Omit<
      appsync.ResolverProps,
      "api" | "fieldName" | "typeName" | "dataSource"
    >;
  };
}

export interface AppSyncApiProps {
  /**
   * The GraphQL schema definition.
   *
   * @example
   *
   * ```js
   * new AppSyncApi(stack, "GraphqlApi", {
   *   schema: "graphql/schema.graphql",
   * });
   * ```
   */
  schema?: string | string[];
  /**
   * Define datasources. Can be a function, dynamodb table, rds cluster or http endpoint
   *
   * @example
   * ```js
   * new AppSyncApi(stack, "GraphqlApi", {
   *   dataSources: {
   *     notes: "src/notes.main",
   *   },
   *   resolvers: {
   *     "Query    listNotes": "notes",
   *   },
   * });
   * ```
   */
  dataSources?: Record<
    string,
    | FunctionInlineDefinition
    | AppSyncApiLambdaDataSourceProps
    | AppSyncApiDynamoDbDataSourceProps
    | AppSyncApiRdsDataSourceProps
    | AppSyncApiHttpDataSourceProps
  >;
  /**
   * The resolvers for this API. Takes an object, with the key being the type name and field name as a string and the value is either a string with the name of existing data source.
   *
   * @example
   * ```js
   * new AppSyncApi(stack, "GraphqlApi", {
   *   resolvers: {
   *     "Query    listNotes": "src/list.main",
   *     "Query    getNoteById": "src/get.main",
   *     "Mutation createNote": "src/create.main",
   *     "Mutation updateNote": "src/update.main",
   *     "Mutation deleteNote": "src/delete.main",
   *   },
   * });
   * ```
   */
  resolvers?: Record<
    string,
    string | FunctionInlineDefinition | AppSyncApiResolverProps
  >;
  defaults?: {
    /**
     * The default function props to be applied to all the Lambda functions in the AppSyncApi. The `environment`, `permissions` and `layers` properties will be merged with per route definitions if they are defined.
     *
     * @example
     * ```js
     * new AppSync(stack, "AppSync", {
     *   defaults: {
     *     function: {
     *       timeout: 20,
     *       environment: { tableName: table.tableName },
     *       permissions: [table],
     *     }
     *   },
     * });
     * ```
     */
    function?: FunctionProps;
  };
  cdk?: {
    graphqlApi?: appsync.IGraphqlApi | AppSyncApiCdkGraphqlProps;
  };
}

export interface AppSyncApiCdkGraphqlProps
  extends Omit<appsync.GraphqlApiProps, "name"> {
  name?: string;
}

/////////////////////
// Construct
/////////////////////

/**
 *
 * The `AppSyncApi` construct is a higher level CDK construct that makes it easy to create an AppSync GraphQL API. It provides a simple way to define the data sources and the resolvers in your API. And allows you to configure the specific Lambda functions if necessary. See the [examples](#examples) for more details.
 *
 * @example
 * ### Using the minimal config
 *
 * ```js
 * import { AppSyncApi } from "@serverless-stack/resources";
 *
 * new AppSyncApi(stack, "GraphqlApi", {
 *   schema: "graphql/schema.graphql",
 *   dataSources: {
 *     notesDS: "src/notes.main",
 *   },
 *   resolvers: {
 *     "Query    listNotes": "notesDS",
 *     "Query    getNoteById": "notesDS",
 *     "Mutation createNote": "notesDS",
 *     "Mutation updateNote": "notesDS",
 *     "Mutation deleteNote": "notesDS",
 *   },
 * });
 * ```
 *
 * Note that, the resolver key can have extra spaces in between, they are just ignored.
 */
export class AppSyncApi extends Construct implements SSTConstruct {
  public readonly cdk: {
    /**
     * The internally created appsync api
     */
    graphqlApi: appsync.GraphqlApi;
  };
  readonly functionsByDsKey: { [key: string]: Fn };
  readonly dataSourcesByDsKey: {
    [key: string]: appsync.BaseDataSource;
  };
  readonly dsKeysByResKey: { [key: string]: string };
  readonly resolversByResKey: { [key: string]: appsync.Resolver };
  readonly permissionsAttachedForAllFunctions: Permissions[];
  readonly props: AppSyncApiProps;

  constructor(scope: Construct, id: string, props?: AppSyncApiProps) {
    super(scope, id);

    this.props = props || {};
    this.cdk = {} as any;
    this.functionsByDsKey = {};
    this.dataSourcesByDsKey = {};
    this.resolversByResKey = {};
    this.dsKeysByResKey = {};
    this.permissionsAttachedForAllFunctions = [];

    this.createGraphApi();

    // Configure data sources
    if (props?.dataSources) {
      for (const key of Object.keys(props.dataSources)) {
        this.addDataSource(this, key, props.dataSources[key]);
      }
    }

    // Configure resolvers
    if (props?.resolvers) {
      for (const key of Object.keys(props.resolvers)) {
        this.addResolver(this, key, props.resolvers[key]);
      }
    }
  }

  /**
   * The Id of the internally created AppSync GraphQL API.
   */
  public get apiId(): string {
    return this.cdk.graphqlApi.apiId;
  }

  /**
   * The ARN of the internally created AppSync GraphQL API.
   */
  public get apiArn(): string {
    return this.cdk.graphqlApi.arn;
  }

  /**
   * The name of the internally created AppSync GraphQL API.
   */
  public get apiName(): string {
    return this.cdk.graphqlApi.name;
  }

  public get url(): string {
    return this.cdk.graphqlApi.graphqlUrl;
  }

  /**
   * Add data sources after the construct has been created
   *
   * @example
   * ```js
   * api.addDataSources(stack, {
   *   billingDS: "src/billing.main",
   * });
   * ```
   */
  public addDataSources(
    scope: Construct,
    dataSources: {
      [key: string]:
        | FunctionInlineDefinition
        | AppSyncApiLambdaDataSourceProps
        | AppSyncApiDynamoDbDataSourceProps
        | AppSyncApiRdsDataSourceProps
        | AppSyncApiHttpDataSourceProps;
    }
  ): void {
    Object.keys(dataSources).forEach((key: string) => {
      // add data source
      const fn = this.addDataSource(scope, key, dataSources[key]);

      // attached existing permissions
      if (fn) {
        this.permissionsAttachedForAllFunctions.forEach((permissions) =>
          fn.attachPermissions(permissions)
        );
      }
    });
  }

  /**
   * Add resolvers the construct has been created
   *
   * @example
   * ```js
   * api.addResolvers(stack, {
   *   "Mutation charge": "billingDS",
   * });
   * ```
   */
  public addResolvers(
    scope: Construct,
    resolvers: {
      [key: string]: FunctionInlineDefinition | AppSyncApiResolverProps;
    }
  ): void {
    Object.keys(resolvers).forEach((key: string) => {
      // add resolver
      const fn = this.addResolver(scope, key, resolvers[key]);

      // attached existing permissions
      if (fn) {
        this.permissionsAttachedForAllFunctions.forEach((permissions) =>
          fn.attachPermissions(permissions)
        );
      }
    });
  }

  /**
   * Get the instance of the internally created Function, for a given resolver.
   *
   * @example
   * ```js
   * const func = api.getFunction("Mutation charge");
   * ```
   */
  public getFunction(key: string): Fn | undefined {
    let fn = this.functionsByDsKey[key];

    if (!fn) {
      const resKey = this.normalizeResolverKey(key);
      const dsKey = this.dsKeysByResKey[resKey];
      fn = this.functionsByDsKey[dsKey];
    }
    return fn;
  }

  /**
   * Get a datasource by name
   * @example
   * ```js
   * api.getDataSource("billingDS");
   * ```
   */
  public getDataSource(key: string): appsync.BaseDataSource | undefined {
    let ds = this.dataSourcesByDsKey[key];

    if (!ds) {
      const resKey = this.normalizeResolverKey(key);
      const dsKey = this.dsKeysByResKey[resKey];
      ds = this.dataSourcesByDsKey[dsKey];
    }
    return ds;
  }

  /**
   * Get a resolver
   *
   * @example
   * ```js
   * api.getResolver("Mutation charge");
   * ```
   */
  public getResolver(key: string): appsync.Resolver | undefined {
    const resKey = this.normalizeResolverKey(key);
    return this.resolversByResKey[resKey];
  }

  /**
   * Attaches the given list of permissions to all function datasources
   *
   * @example
   *
   * ```js
   * api.attachPermissions(["s3"]);
   * ```
   */
  public attachPermissions(permissions: Permissions): void {
    Object.values(this.functionsByDsKey).forEach((fn) =>
      fn.attachPermissions(permissions)
    );
    this.permissionsAttachedForAllFunctions.push(permissions);
  }

  /**
   * Attaches the given list of permissions to a specific function datasource. This allows that function to access other AWS resources.
   *
   * @example
   * api.attachPermissionsToRoute("Mutation charge", ["s3"]);
   * ```
   */
  public attachPermissionsToDataSource(
    key: string,
    permissions: Permissions
  ): void {
    const fn = this.getFunction(key);
    if (!fn) {
      throw new Error(
        `Failed to attach permissions. Function does not exist for key "${key}".`
      );
    }

    fn.attachPermissions(permissions);
  }

  public getConstructMetadata() {
    return {
      type: "AppSync" as const,
      data: {
        url: this.cdk.graphqlApi.graphqlUrl,
        appSyncApiId: this.cdk.graphqlApi.apiId,
        dataSources: Object.entries(this.dataSourcesByDsKey).map(([key]) => ({
          name: key,
          fn: getFunctionRef(this.functionsByDsKey[key]),
        })),
      },
    };
  }

  private createGraphApi() {
    const { schema, cdk } = this.props;
    const id = this.node.id;
    const app = this.node.root as App;

    if (isCDKConstruct(cdk?.graphqlApi)) {
      this.cdk.graphqlApi = cdk?.graphqlApi as appsync.GraphqlApi;
    } else {
      const graphqlApiProps = (cdk?.graphqlApi ||
        {}) as AppSyncApiCdkGraphqlProps;

      // build schema
      let mainSchema: appsync.Schema | undefined;
      if (typeof schema === "string") {
        mainSchema = appsync.Schema.fromAsset(schema);
      } else if (Array.isArray(schema)) {
        if (schema.length > 0) {
          // merge schema files
          const mergedSchema = mergeTypeDefs(loadFilesSync(schema));
          const filePath = path.join(
            app.buildDir,
            `appsyncapi-${id}-${this.node.addr}.graphql`
          );
          fs.writeFileSync(filePath, print(mergedSchema));
          mainSchema = appsync.Schema.fromAsset(filePath);
        }
      }

      this.cdk.graphqlApi = new appsync.GraphqlApi(this, "Api", {
        name: app.logicalPrefixedName(id),
        xrayEnabled: true,
        schema: mainSchema,
        ...graphqlApiProps,
      });
    }
  }

  private addDataSource(
    scope: Construct,
    dsKey: string,
    dsValue:
      | FunctionInlineDefinition
      | AppSyncApiLambdaDataSourceProps
      | AppSyncApiDynamoDbDataSourceProps
      | AppSyncApiRdsDataSourceProps
      | AppSyncApiHttpDataSourceProps
  ): Fn | undefined {
    let dataSource;
    let lambda;

    // Lambda ds
    if ((dsValue as AppSyncApiLambdaDataSourceProps).function) {
      dsValue = dsValue as AppSyncApiLambdaDataSourceProps;
      lambda = Fn.fromDefinition(
        scope,
        `Lambda_${dsKey}`,
        dsValue.function,
        this.props.defaults?.function,
        `Cannot define defaults.function when a Function is passed in to the "${dsKey} data source`
      );
      dataSource = this.cdk.graphqlApi.addLambdaDataSource(dsKey, lambda, {
        name: dsValue.name,
        description: dsValue.description,
      });
    }
    // DynamoDb ds
    else if (
      (dsValue as AppSyncApiDynamoDbDataSourceProps).table ||
      (dsValue as AppSyncApiDynamoDbDataSourceProps).cdk?.dataSource?.table
    ) {
      dsValue = dsValue as AppSyncApiDynamoDbDataSourceProps;
      dataSource = this.cdk.graphqlApi.addDynamoDbDataSource(
        dsKey,
        dsValue.table
          ? dsValue.table.cdk.table
          : dsValue.cdk?.dataSource?.table!,
        {
          name: dsValue.name,
          description: dsValue.description,
        }
      );
    }
    // Rds ds
    else if (
      (dsValue as AppSyncApiRdsDataSourceProps).rds ||
      (dsValue as AppSyncApiRdsDataSourceProps).cdk?.dataSource
        ?.serverlessCluster
    ) {
      dsValue = dsValue as AppSyncApiRdsDataSourceProps;
      dataSource = this.cdk.graphqlApi.addRdsDataSource(
        dsKey,
        dsValue.rds
          ? dsValue.rds.cdk.cluster
          : dsValue.cdk?.dataSource?.serverlessCluster!,
        dsValue.rds
          ? dsValue.rds.cdk.cluster.secret!
          : dsValue.cdk?.dataSource?.secretStore!,
        dsValue.rds
          ? dsValue.databaseName || dsValue.rds.defaultDatabaseName
          : dsValue.cdk?.dataSource?.databaseName,
        {
          name: dsValue.name,
          description: dsValue.description,
        }
      );
    }
    // Http ds
    else if ((dsValue as AppSyncApiHttpDataSourceProps).endpoint) {
      dsValue = dsValue as AppSyncApiHttpDataSourceProps;
      dataSource = this.cdk.graphqlApi.addHttpDataSource(
        dsKey,
        dsValue.endpoint,
        {
          name: dsValue.name,
          description: dsValue.description,
        }
      );
    }
    // Lambda function
    else {
      dsValue = dsValue as FunctionInlineDefinition;
      lambda = Fn.fromDefinition(
        scope,
        `Lambda_${dsKey}`,
        dsValue,
        this.props.defaults?.function,
        `Cannot define defaults.function when a Function is passed in to the "${dsKey} data source`
      );
      dataSource = this.cdk.graphqlApi.addLambdaDataSource(dsKey, lambda);
    }
    this.dataSourcesByDsKey[dsKey] = dataSource;
    if (lambda) {
      this.functionsByDsKey[dsKey] = lambda;
    }

    return lambda;
  }

  private addResolver(
    scope: Construct,
    resKey: string,
    resValue: FunctionInlineDefinition | AppSyncApiResolverProps
  ): Fn | undefined {
    // Normalize resKey
    resKey = this.normalizeResolverKey(resKey);

    // Get type and field
    const resolverKeyParts = resKey.split(" ");
    if (resolverKeyParts.length !== 2) {
      throw new Error(`Invalid resolver ${resKey}`);
    }
    const [typeName, fieldName] = resolverKeyParts;
    if (fieldName.length === 0) {
      throw new Error(`Invalid field defined for "${resKey}"`);
    }

    ///////////////////
    // Create data source if not created before
    ///////////////////
    let lambda;
    let dataSource;
    let dataSourceKey;
    let resolverProps;

    // DataSource key
    if (
      typeof resValue === "string" &&
      Object.keys(this.dataSourcesByDsKey).includes(resValue)
    ) {
      dataSourceKey = resValue;
      dataSource = this.dataSourcesByDsKey[resValue];
      resolverProps = {};
    }
    // DataSource key not exist (string does not have a dot, assume it is referencing a data store)
    else if (typeof resValue === "string" && resValue.indexOf(".") === -1) {
      throw new Error(
        `Failed to create resolver "${resKey}". Data source "${resValue}" does not exist.`
      );
    }
    // Lambda resolver
    else if (this.isLambdaResolverProps(resValue as AppSyncApiResolverProps)) {
      resValue = resValue as AppSyncApiResolverProps;
      lambda = Fn.fromDefinition(
        scope,
        `Lambda_${typeName}_${fieldName}`,
        resValue.function as FunctionDefinition,
        this.props.defaults?.function,
        `Cannot define defaults.function when a Function is passed in to the "${resKey} resolver`
      );
      dataSourceKey = this.buildDataSourceKey(typeName, fieldName);
      dataSource = this.cdk.graphqlApi.addLambdaDataSource(
        dataSourceKey,
        lambda
      );
      resolverProps = {
        requestMappingTemplate: this.buildMappingTemplate(
          resValue.requestMapping
        ),
        responseMappingTemplate: this.buildMappingTemplate(
          resValue.responseMapping
        ),
        ...resValue.cdk?.resolver,
      };
    }
    // DataSource resolver
    else if (
      this.isDataSourceResolverProps(resValue as AppSyncApiResolverProps)
    ) {
      resValue = resValue as AppSyncApiResolverProps;
      dataSourceKey = resValue.dataSource as string;
      dataSource = this.dataSourcesByDsKey[dataSourceKey];
      resolverProps = {
        requestMappingTemplate: this.buildMappingTemplate(
          resValue.requestMapping
        ),
        responseMappingTemplate: this.buildMappingTemplate(
          resValue.responseMapping
        ),
        ...resValue.cdk?.resolver,
      };
    }
    // Lambda function
    else {
      resValue = resValue as FunctionInlineDefinition;
      lambda = Fn.fromDefinition(
        scope,
        `Lambda_${typeName}_${fieldName}`,
        resValue,
        this.props.defaults?.function,
        `Cannot define defaults.function when a Function is passed in to the "${resKey} resolver`
      );
      dataSourceKey = this.buildDataSourceKey(typeName, fieldName);
      dataSource = this.cdk.graphqlApi.addLambdaDataSource(
        dataSourceKey,
        lambda
      );
      resolverProps = {};
    }

    // Store new data source created
    if (lambda) {
      this.dataSourcesByDsKey[dataSourceKey] = dataSource;
      this.functionsByDsKey[dataSourceKey] = lambda;
    }
    this.dsKeysByResKey[resKey] = dataSourceKey;

    ///////////////////
    // Create resolver
    ///////////////////
    const resolver = this.cdk.graphqlApi.createResolver({
      dataSource,
      typeName,
      fieldName,
      ...resolverProps,
    });
    this.resolversByResKey[resKey] = resolver;

    return lambda;
  }

  private isLambdaResolverProps(object: AppSyncApiResolverProps): boolean {
    return object.function !== undefined;
  }

  private isDataSourceResolverProps(object: AppSyncApiResolverProps): boolean {
    return object.dataSource !== undefined;
  }

  private normalizeResolverKey(resolverKey: string): string {
    // remove extra spaces in the key
    return resolverKey.split(/\s+/).join(" ");
  }

  private buildMappingTemplate(mapping?: MappingTemplate) {
    if (!mapping) {
      return undefined;
    }

    if ((mapping as MappingTemplateFile).file) {
      return appsync.MappingTemplate.fromFile(
        (mapping as MappingTemplateFile).file
      );
    }

    return appsync.MappingTemplate.fromString(
      (mapping as MappingTemplateInline).inline
    );
  }

  private buildDataSourceKey(typeName: string, fieldName: string): string {
    return `LambdaDS_${typeName}_${fieldName}`;
  }
}
