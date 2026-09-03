'use client';

import React, { useRef, useState, type FormEvent } from 'react';
import type { Comment, CommentTarget } from '../modules/community/index.js';
import { commentAction } from './comment-actions.js';

interface CommentsProps {
  target: CommentTarget;
  initialComments: Comment[];
  isSignedIn: boolean;
}

export function appendComment(existing: Comment[], inserted: Comment): Comment[] {
  return [...existing, inserted];
}

interface SubmitCommentCallbacks {
  append(inserted: Comment): void;
  clear(): void;
  fail(message: string): void;
}

export async function submitComment(
  target: CommentTarget,
  body: string,
  action: typeof commentAction,
  callbacks: SubmitCommentCallbacks,
): Promise<void> {
  try {
    const inserted = await action(target, body);
    callbacks.append(inserted);
    callbacks.clear();
  } catch (reason) {
    callbacks.fail(reason instanceof Error ? reason.message : 'Unable to post comment.');
  }
}

export function Comments({ target, initialComments, isSignedIn }: CommentsProps) {
  const [displayedComments, setDisplayedComments] = useState(initialComments);
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submissionInFlight = useRef(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submissionInFlight.current) return;
    submissionInFlight.current = true;
    setError(null);
    setIsSubmitting(true);
    try {
      await submitComment(target, body, commentAction, {
        append: (inserted) => setDisplayedComments((existing) => appendComment(existing, inserted)),
        clear: () => setBody(''),
        fail: setError,
      });
    } finally {
      submissionInFlight.current = false;
      setIsSubmitting(false);
    }
  }

  return (
    <section>
      <h2>Comments</h2>
      <ol>
        {displayedComments.map((comment) => <li key={comment.id}>{comment.body}</li>)}
      </ol>
      {isSignedIn ? (
        <form onSubmit={submit}>
          <label htmlFor={`comment-${target.type}-${target.id}`}>Add a comment</label>
          <textarea
            id={`comment-${target.type}-${target.id}`}
            value={body}
            onChange={(event) => setBody(event.target.value)}
            disabled={isSubmitting}
          />
          <button type="submit" disabled={isSubmitting}>Post comment</button>
          {error ? <p>{error}</p> : null}
        </form>
      ) : null}
    </section>
  );
}
