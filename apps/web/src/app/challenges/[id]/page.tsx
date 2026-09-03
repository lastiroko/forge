import { notFound } from 'next/navigation';
import {
  getChallenge,
  getEnabledStacks,
  getLatestPublishedVersion,
  loadOpenApiContract,
  type OpenApiSchemaShape,
} from '../../../modules/catalogue/index.js';
import { getCurrentUser } from '../../../modules/identity/index.js';
import { StartChallengeFlow } from './StartChallengeFlow.js';

export const revalidate = 60;

interface RubricWeights {
  functional: number;
  contract: number;
  robustness: number;
  quality: number;
}

function describeSchemaShape(shape: OpenApiSchemaShape): string {
  const suffix = shape.nullable ? ' | null' : '';
  if (shape.type === 'array') {
    return `array<${shape.items ? describeSchemaShape(shape.items) : 'unknown'}>${suffix}`;
  }
  if (shape.type === 'object') {
    const properties = (shape.properties ?? [])
      .map((property) => `${property.name}${property.required ? '' : '?'}: ${describeSchemaShape(property.schema)}`)
      .join(', ');
    return `object { ${properties} }${suffix}`;
  }
  return `${shape.type}${shape.format ? ` (${shape.format})` : ''}${suffix}`;
}

export default async function ChallengePage({ params }: { params: { id: string } }) {
  const challenge = await getChallenge(params.id);
  if (!challenge) notFound();
  const version = await getLatestPublishedVersion(params.id);
  if (!version) notFound();
  const rubric = version.rubric as RubricWeights;
  const enabledStacks = await getEnabledStacks(params.id);
  const contract = await loadOpenApiContract(version.openapiRef);

  let user;
  try {
    user = await getCurrentUser();
  } catch {
    // identity.getCurrentUser is an unimplemented skeleton that always throws, so treat this as signed out for now.
    user = undefined;
  }

  return (
    <main>
      <h1>{challenge.title}</h1>
      <p>{challenge.level}</p>
      <pre>{version.brief}</pre>
      <h2>Rubric weights</h2>
      <dl>
        <dt>Functional</dt>
        <dd>{rubric.functional}</dd>
        <dt>Contract</dt>
        <dd>{rubric.contract}</dd>
        <dt>Robustness</dt>
        <dd>{rubric.robustness}</dd>
        <dt>Quality</dt>
        <dd>{rubric.quality}</dd>
      </dl>
      <h2>API contract</h2>
      {contract.operations.map((operation) => (
        <section key={`${operation.method}-${operation.path}`}>
          <h3>{`${operation.method.toUpperCase()} ${operation.path}`}</h3>
          {operation.summary ? <p>{operation.summary}</p> : null}
          {operation.description ? <p>{operation.description}</p> : null}
          {operation.parameters.length > 0 ? (
            <>
              <h4>Parameters</h4>
              <ul>
                {operation.parameters.map((parameter) => (
                  <li key={`${parameter.in}-${parameter.name}`}>
                    <code>{parameter.name}</code> ({parameter.in}, {parameter.required ? 'required' : 'optional'})
                    {parameter.schema ? `: ${describeSchemaShape(parameter.schema)}` : null}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          {operation.requestBody ? (
            <>
              <h4>Request body</h4>
              <p>{operation.requestBody.required ? 'Required' : 'Optional'}</p>
              <ul>
                {operation.requestBody.content.map((media) => (
                  <li key={media.contentType}>
                    <dl>
                      <dt>{media.contentType}</dt>
                      <dd>{media.schema ? describeSchemaShape(media.schema) : 'No schema'}</dd>
                    </dl>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          <h4>Responses</h4>
          <ul>
            {operation.responses.map((response) => (
              <li key={response.status}>
                <dl>
                  <dt>{response.status}{response.description ? ` ${response.description}` : ''}</dt>
                  <dd>
                    {response.content.length > 0
                      ? response.content
                          .map((media) => `${media.contentType}: ${media.schema ? describeSchemaShape(media.schema) : 'No schema'}`)
                          .join('; ')
                      : 'No content'}
                  </dd>
                </dl>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {user ? (
        <StartChallengeFlow
          challengeId={challenge.id}
          userId={user.id}
          backendEnabled={challenge.backendEnabled}
          fullstackEnabled={challenge.fullstackEnabled}
          stacks={enabledStacks.map((stack) => ({
            id: stack.id,
            language: stack.language,
            framework: stack.framework,
          }))}
        />
      ) : <p>Sign in with GitHub to start this challenge.</p>}
    </main>
  );
}
