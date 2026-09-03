import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { loadOpenApiContract } from './index.js';

function fetchStub(body: string, status = 200): typeof fetch {
  return (async () => new Response(body, { status })) as typeof fetch;
}

const SAMPLE_YAML = `
openapi: 3.0.3
paths:
  /items:
    parameters:
      - name: X-Request-Id
        in: header
        required: false
        schema:
          type: string
    get:
      summary: List items
      parameters:
        - name: limit
          in: query
          required: false
          schema:
            type: integer
            format: int32
        - name: X-Request-Id
          in: header
          required: true
          schema:
            type: string
      responses:
        '200':
          description: A page of items
          content:
            application/json:
              schema:
                type: array
                items:
                  $ref: '#/components/schemas/Item'
    post:
      summary: Create an item
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/ItemInput'
      responses:
        '201':
          description: The created item
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Item'
        '400':
          description: Validation error
          content:
            application/json:
              schema:
                type: object
                required:
                  - message
                properties:
                  message:
                    type: string
  /items/{itemId}:
    parameters:
      - name: itemId
        in: path
        required: true
        schema:
          type: string
          format: uuid
    get:
      summary: Get an item
      responses:
        '200':
          description: The item
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Item'
        '404':
          description: Item not found
    delete:
      summary: Delete an item
      responses:
        '204':
          description: Deleted
components:
  schemas:
    Item:
      type: object
      required:
        - id
        - name
      properties:
        id:
          type: string
          format: uuid
        name:
          type: string
        description:
          type: string
          nullable: true
        tags:
          type: array
          items:
            type: string
    ItemInput:
      type: object
      required:
        - name
      properties:
        name:
          type: string
        description:
          type: string
          nullable: true
`;

test('loadOpenApiContract returns every path and method declared in the document', async () => {
  const contract = await loadOpenApiContract('https://contracts.example.com/openapi.yaml', fetchStub(SAMPLE_YAML));

  const pairs = contract.operations.map((operation) => `${operation.method} ${operation.path}`);
  assert.deepEqual(pairs, ['get /items', 'post /items', 'get /items/{itemId}', 'delete /items/{itemId}']);
});

test('loadOpenApiContract inherits path-level parameters and lets an operation-level parameter override them', async () => {
  const contract = await loadOpenApiContract('https://contracts.example.com/openapi.yaml', fetchStub(SAMPLE_YAML));

  const getItems = contract.operations.find((operation) => operation.method === 'get' && operation.path === '/items');
  assert.ok(getItems);
  const limit = getItems!.parameters.find((parameter) => parameter.name === 'limit');
  assert.equal(limit?.in, 'query');
  assert.equal(limit?.required, false);
  assert.equal(limit?.schema?.type, 'integer');
  assert.equal(limit?.schema?.format, 'int32');

  const requestId = getItems!.parameters.find((parameter) => parameter.name === 'X-Request-Id');
  assert.equal(requestId?.required, true, 'operation-level parameter should override the path-level definition');

  const deleteItem = contract.operations.find((operation) => operation.method === 'delete' && operation.path === '/items/{itemId}');
  const itemId = deleteItem!.parameters.find((parameter) => parameter.name === 'itemId');
  assert.ok(itemId, 'path-level parameter should be inherited by an operation with no parameters of its own');
  assert.equal(itemId?.in, 'path');
  assert.equal(itemId?.required, true);
});

test('loadOpenApiContract represents request bodies and resolves local component-schema references', async () => {
  const contract = await loadOpenApiContract('https://contracts.example.com/openapi.yaml', fetchStub(SAMPLE_YAML));

  const createItem = contract.operations.find((operation) => operation.method === 'post' && operation.path === '/items');
  assert.equal(createItem?.requestBody?.required, true);
  const requestSchema = createItem?.requestBody?.content[0]?.schema;
  assert.equal(requestSchema?.type, 'object');
  const nameProperty = requestSchema?.properties?.find((property) => property.name === 'name');
  assert.equal(nameProperty?.required, true);
  const descriptionProperty = requestSchema?.properties?.find((property) => property.name === 'description');
  assert.equal(descriptionProperty?.required, false);
  assert.equal(descriptionProperty?.schema.nullable, true);
});

test('loadOpenApiContract represents nested array and object response shapes across all status codes', async () => {
  const contract = await loadOpenApiContract('https://contracts.example.com/openapi.yaml', fetchStub(SAMPLE_YAML));

  const listItems = contract.operations.find((operation) => operation.method === 'get' && operation.path === '/items');
  const statuses = listItems!.responses.map((response) => response.status);
  assert.deepEqual(statuses, ['200']);
  const listSchema = listItems!.responses[0].content[0]?.schema;
  assert.equal(listSchema?.type, 'array');
  assert.equal(listSchema?.items?.type, 'object');
  const tagsProperty = listSchema?.items?.properties?.find((property) => property.name === 'tags');
  assert.equal(tagsProperty?.schema.type, 'array');
  assert.equal(tagsProperty?.schema.items?.type, 'string');

  const createItem = contract.operations.find((operation) => operation.method === 'post' && operation.path === '/items');
  const createStatuses = createItem!.responses.map((response) => response.status).sort();
  assert.deepEqual(createStatuses, ['201', '400']);

  const getItem = contract.operations.find((operation) => operation.method === 'get' && operation.path === '/items/{itemId}');
  const notFound = getItem!.responses.find((response) => response.status === '404');
  assert.equal(notFound?.description, 'Item not found');
  assert.deepEqual(notFound?.content, []);
});

test('loadOpenApiContract rejects when openapiRef is not an absolute URL', async () => {
  await assert.rejects(loadOpenApiContract('openapi/v1.yaml', fetchStub(SAMPLE_YAML)), (error) => {
    assert.ok(error instanceof Error);
    assert.ok(error.message.includes('not an absolute URL'));
    return true;
  });
});

test('loadOpenApiContract rejects when the fetch response is not successful', async () => {
  await assert.rejects(
    loadOpenApiContract('https://contracts.example.com/openapi.yaml', fetchStub('not found', 404)),
    (error) => {
      assert.ok(error instanceof Error);
      assert.ok(error.message.includes('404'));
      return true;
    },
  );
});

test('loadOpenApiContract rejects when the document is not valid YAML', async () => {
  await assert.rejects(
    loadOpenApiContract('https://contracts.example.com/openapi.yaml', fetchStub('paths:\n  /widgets:\n\tget: broken\n')),
    (error) => {
      assert.ok(error instanceof Error);
      assert.ok(error.message.includes('not valid YAML'));
      return true;
    },
  );
});

test('loadOpenApiContract rejects when the document has no paths object', async () => {
  await assert.rejects(
    loadOpenApiContract('https://contracts.example.com/openapi.yaml', fetchStub('openapi: 3.0.3\ninfo:\n  title: Empty\n')),
    (error) => {
      assert.ok(error instanceof Error);
      assert.ok(error.message.includes('paths'));
      return true;
    },
  );
});

test('loadOpenApiContract rejects when a schema references an unknown local component', async () => {
  const yaml = `
paths:
  /items:
    get:
      responses:
        '200':
          description: ok
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Missing'
components:
  schemas: {}
`;
  await assert.rejects(loadOpenApiContract('https://contracts.example.com/openapi.yaml', fetchStub(yaml)), (error) => {
    assert.ok(error instanceof Error);
    assert.ok(error.message.includes('unknown schema'));
    return true;
  });
});

test('loadOpenApiContract rejects when a local schema reference is cyclic', async () => {
  const yaml = `
paths:
  /items:
    get:
      responses:
        '200':
          description: ok
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Node'
components:
  schemas:
    Node:
      type: object
      properties:
        child:
          $ref: '#/components/schemas/Node'
`;
  await assert.rejects(loadOpenApiContract('https://contracts.example.com/openapi.yaml', fetchStub(yaml)), (error) => {
    assert.ok(error instanceof Error);
    assert.ok(error.message.includes('cyclic'));
    return true;
  });
});
