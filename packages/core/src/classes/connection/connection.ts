import {
  DYNAMO_QUERY_ITEMS_IMPLICIT_LIMIT,
  EntityTarget,
  Table,
} from '@typedorm/common';
import {DynamoDB} from 'aws-sdk';
import {EntityManager} from '../manager/entity-manager';
import {TransactionManager} from '../manager/transaction-manager';
import {AttributeMetadata} from '../metadata/attribute-metadata';
import {AutoGeneratedAttributeMetadata} from '../metadata/auto-generated-attribute-metadata';
import {
  DynamoEntitySchemaPrimaryKey,
  EntityMetadata,
} from '../metadata/entity-metadata';
import {ConnectionMetadataBuilder} from './connection-metadata-builder';
import {ConnectionOptions} from './connection-options';

export class Connection {
  readonly name: string;
  readonly table: Table;
  readonly entityManager: EntityManager;
  readonly transactionManger: TransactionManager;
  readonly defaultConfig: {queryItemsImplicitLimit: number};
  readonly documentClient: DynamoDB.DocumentClient;

  private _entityMetadatas: Map<string, EntityMetadata>;
  private isConnected: boolean;

  constructor(private options: ConnectionOptions) {
    const {table, name = 'default'} = options;
    if (table) {
      this.table = table;
    }
    this.name = name;
    this.entityManager = new EntityManager(this);
    this.transactionManger = new TransactionManager(this);
    this.defaultConfig = {
      queryItemsImplicitLimit:
        options.dynamoQueryItemsImplicitLimit ??
        DYNAMO_QUERY_ITEMS_IMPLICIT_LIMIT,
    };

    if (options.documentClient) {
      this.documentClient = options.documentClient;
    } else {
      this.documentClient = new DynamoDB.DocumentClient();
    }
    /**
     * This makes sure that we only ever build entity metadatas once per connection
     */
    this.isConnected = false;
  }

  connect() {
    if (this.isConnected) {
      throw new Error(
        'There is already an active connection, Connect should only be called once per application.'
      );
    }

    this._entityMetadatas = new Map(
      this.buildMetadatas().map(entityMeta => [
        entityMeta.target.name,
        entityMeta,
      ])
    );

    this.isConnected = true;
    return this;
  }

  get entityMetadatas() {
    return Array.from(this._entityMetadatas.values());
  }

  hasMetadata<Entity>(entityClass: EntityTarget<Entity>) {
    return !!this.getEntityByTarget(entityClass);
  }

  getAttributesForEntity<Entity>(entityClass: EntityTarget<Entity>) {
    const attributesMap = this._entityMetadatas.get(entityClass.name);
    if (!attributesMap) {
      throw new Error(
        `Cannot find attributes for entity "${entityClass.name}".`
      );
    }
    return attributesMap.attributes;
  }

  get globalTable() {
    return this.table;
  }

  /**
   * Returns any attributes marked as unique
   * If attribute used in a primary key is marked as unique, it is ignored, since all primary key are always unique
   * @param entityClass
   */
  getUniqueAttributesForEntity<Entity>(entityClass: EntityTarget<Entity>) {
    const entityMetadata = this.getEntityByTarget(entityClass);

    if (!entityMetadata) {
      throw new Error(
        'Could not get unique attributes for entity, every class to be used as entity must have @Entity decorator on it.'
      );
    }

    return this.getAttributesForEntity<Entity>(entityClass).filter(attr => {
      // only attributes that are not part of primary key should be included
      return (
        (attr as AttributeMetadata)?.unique &&
        !this.isUsedForPrimaryKey(entityMetadata.schema.primaryKey, attr.name)
      );
    });
  }

  getEntityByTarget<Entity>(entityClass: EntityTarget<Entity>) {
    const metadata = this._entityMetadatas.get(entityClass.name);
    if (!metadata) {
      throw new Error(
        `No such entity named "${entityClass.name}" is known to TypeDrm, make sure it is declared at the connection creation time.`
      );
    }
    return metadata;
  }

  getAutoUpdateAttributes<Entity>(entityClass: EntityTarget<Entity>) {
    return this.getAttributesForEntity(entityClass).filter(
      attr => (attr as AutoGeneratedAttributeMetadata)?.autoUpdate
    ) as AutoGeneratedAttributeMetadata[];
  }

  isUsedForPrimaryKey(
    primaryKey: DynamoEntitySchemaPrimaryKey,
    attributeName: string
  ) {
    const primaryKeyInterpolations = primaryKey._interpolations ?? {};
    return Object.keys(primaryKeyInterpolations).some(key => {
      const currInterpolation = primaryKeyInterpolations[key];
      return currInterpolation.includes(attributeName);
    });
  }

  private buildMetadatas() {
    return new ConnectionMetadataBuilder(this).buildEntityMetadatas(
      this.options.entities
    );
  }
}
