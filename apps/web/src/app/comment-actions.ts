'use server';

import { cookies } from 'next/headers';
import { comment, type Comment, type CommentTarget } from '../modules/community/index.js';

export async function commentAction(target: CommentTarget, body: string): Promise<Comment> {
  const trimmedBody = body.trim();
  if (!trimmedBody) throw new Error('Comment cannot be empty.');
  return comment(target, trimmedBody, cookies());
}
