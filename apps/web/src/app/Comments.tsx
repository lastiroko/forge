'use client';

import { useState, useTransition, type FormEvent } from 'react';
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

export function Comments({ target, initialComments, isSignedIn }: CommentsProps) {
  const [displayedComments, setDisplayedComments] = useState(initialComments);
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    startTransition(() => {
      commentAction(target, body)
        .then((inserted) => {
          setDisplayedComments((existing) => appendComment(existing, inserted));
          setBody('');
        })
        .catch((reason: unknown) => {
          setError(reason instanceof Error ? reason.message : 'Unable to post comment.');
        });
    });
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
            disabled={isPending}
          />
          <button type="submit" disabled={isPending}>Post comment</button>
          {error ? <p>{error}</p> : null}
        </form>
      ) : null}
    </section>
  );
}
