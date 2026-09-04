'use client';

import { useState, useTransition } from 'react';
import type { StartChallengeResult } from '../../../modules/enrollment/index.js';
import { attachRepositoryUrlAction, startChallengeAction } from './actions.js';
import { getEnabledCombinations, type StackOption } from './enabled-combinations.js';

interface StartChallengeFlowProps {
  challengeId: string;
  userId: string;
  backendEnabled: boolean;
  fullstackEnabled: boolean;
  stacks: StackOption[];
}

export function StartChallengeFlow({
  challengeId,
  userId,
  backendEnabled,
  fullstackEnabled,
  stacks,
}: StartChallengeFlowProps) {
  const [combinations] = useState(() => getEnabledCombinations({ backendEnabled, fullstackEnabled }, stacks));
  const [pickerOpen, setPickerOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [startResult, setStartResult] = useState<StartChallengeResult | null>(null);
  const [attachedRepoUrl, setAttachedRepoUrl] = useState<string | null>(null);
  const [repoUrlInput, setRepoUrlInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [isAttaching, startAttachTransition] = useTransition();

  if (combinations.length === 0) {
    return <p>No stacks are enabled for this challenge yet.</p>;
  }

  function confirm() {
    const combination = combinations[selectedIndex];
    setError(null);
    startTransition(() => {
      startChallengeAction(userId, challengeId, combination.mode, combination.stack.id)
        .then(setStartResult)
        .catch(() => setError('Unable to start this challenge. Please try again.'));
    });
  }

  function submitRepositoryUrl(enrollmentId: string) {
    setAttachError(null);
    startAttachTransition(() => {
      attachRepositoryUrlAction(enrollmentId, repoUrlInput)
        .then((updated) => {
          if (updated?.repoUrl) {
            setAttachedRepoUrl(updated.repoUrl);
          } else {
            setAttachError('Unable to save that repository URL. Please try again.');
          }
        })
        .catch(() => setAttachError('Enter a valid https://github.com/<owner>/<repo> URL.'));
    });
  }

  if (startResult) {
    const repoUrl = attachedRepoUrl ?? startResult.repoUrl;

    if (repoUrl) {
      return (
        <section>
          <a href={repoUrl}>Open your challenge repository</a>
          <ol>
            <li>Clone the repository.</li>
            <li>Run it locally per the README.</li>
            <li>Run the included checks before you submit.</li>
          </ol>
        </section>
      );
    }

    if (startResult.downloadUrl) {
      return (
        <section>
          <a href={startResult.downloadUrl}>Download starter kit</a>
          <ol>
            <li>Download and unzip the starter kit.</li>
            <li>Create a new GitHub repository and push these files to it.</li>
            <li>Paste the repository URL below once it is ready.</li>
          </ol>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              submitRepositoryUrl(startResult.enrollment.id);
            }}
          >
            <input
              type="url"
              value={repoUrlInput}
              onChange={(event) => setRepoUrlInput(event.target.value)}
              placeholder="https://github.com/you/your-repo"
            />
            <button type="submit" disabled={isAttaching}>Save repository URL</button>
          </form>
          {attachError ? <p>{attachError}</p> : null}
        </section>
      );
    }

    return <p>Your starter files are being prepared. This enrollment is saved as {startResult.enrollment.id}.</p>;
  }

  return (
    <section>
      <button type="button" onClick={() => setPickerOpen(true)}>Start challenge</button>
      {pickerOpen ? (
        <div>
          <select value={selectedIndex} onChange={(event) => setSelectedIndex(Number(event.target.value))}>
            {combinations.map((combination, index) => (
              <option key={`${combination.mode}-${combination.stack.id}`} value={index}>
                {combination.mode} — {combination.stack.language} / {combination.stack.framework}
              </option>
            ))}
          </select>
          <button type="button" onClick={confirm} disabled={isPending}>Confirm</button>
        </div>
      ) : null}
      {error ? <p>{error}</p> : null}
    </section>
  );
}
