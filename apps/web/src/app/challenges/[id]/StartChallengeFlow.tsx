'use client';

import { useState, useTransition } from 'react';
import type { Enrollment } from '../../../modules/enrollment/index.js';
import { startChallengeAction } from './actions.js';
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
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (combinations.length === 0) {
    return <p>No stacks are enabled for this challenge yet.</p>;
  }

  function confirm() {
    const combination = combinations[selectedIndex];
    setError(null);
    startTransition(() => {
      startChallengeAction(userId, challengeId, combination.mode, combination.stack.id)
        .then(setEnrollment)
        .catch(() => setError('Unable to start this challenge. Please try again.'));
    });
  }

  if (enrollment) {
    if (enrollment.repoUrl) {
      return (
        <section>
          <a href={enrollment.repoUrl}>Open your challenge repository</a>
          <ol>
            <li>Clone the repository.</li>
            <li>Run it locally per the README.</li>
            <li>Run the included checks before you submit.</li>
          </ol>
        </section>
      );
    }
    return <p>Your starter files are being prepared. This enrollment is saved as {enrollment.id}.</p>;
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
