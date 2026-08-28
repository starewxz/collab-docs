"use client";

import { useEffect, useMemo, useState } from "react";
import type { ChangeEvent } from "react";
import { Avatar, Badge, Button, EmptyState, SlideOverPanel, Spinner, useToast } from "@/components/ui";
import { CloseIcon, MessageIcon } from "@/components/ui/icons";
import { useAuth } from "@/features/auth/AuthProvider";
import { canModerateComments } from "@/features/workspaces/permissions";
import { listMembers } from "@/features/workspaces/api";
import type { Member, WorkspaceRole } from "@/features/workspaces/types";
import { isApiError } from "@/lib/api-error";
import {
  createComment,
  deleteComment,
  listComments,
  reopenComment,
  resolveComment,
  updateComment,
} from "./api";
import type { Comment, CommentThread } from "./types";
import styles from "./CommentsPanel.module.css";

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString();
}

function memberLabel(member: Member): string {
  return `${member.firstName} ${member.lastName}`.trim() || member.email;
}

/** Finds an in-progress "@query" immediately before the cursor, if any. No
 * attempt is made to parse @mentions back out of free text on submit - the
 * picker below is the single source of truth for `mentionedUserIds`. */
function findMentionQuery(
  text: string,
  cursor: number,
): { start: number; query: string } | null {
  const upToCursor = text.slice(0, cursor);
  const match = /(?:^|\s)@([\w.-]*)$/.exec(upToCursor);
  if (!match) return null;
  return { start: cursor - match[1].length - 1, query: match[1] };
}

function MentionComposer({
  value,
  onChange,
  mentionedUserIds,
  onMentionedUserIdsChange,
  members,
  placeholder,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  mentionedUserIds: string[];
  onMentionedUserIdsChange: (ids: string[]) => void;
  members: Member[];
  placeholder: string;
  disabled?: boolean;
}) {
  const [mentionState, setMentionState] = useState<{ start: number; query: string } | null>(
    null,
  );

  const suggestions = useMemo(() => {
    if (!mentionState) return [];
    const query = mentionState.query.toLowerCase();
    return members
      .filter(
        (m) =>
          memberLabel(m).toLowerCase().includes(query) ||
          m.email.toLowerCase().includes(query),
      )
      .slice(0, 5);
  }, [mentionState, members]);

  function handleChange(e: ChangeEvent<HTMLTextAreaElement>) {
    const el = e.target;
    onChange(el.value);
    setMentionState(findMentionQuery(el.value, el.selectionStart ?? el.value.length));
  }

  function handlePick(member: Member) {
    if (!mentionState) return;
    const before = value.slice(0, mentionState.start);
    const after = value.slice(mentionState.start + 1 + mentionState.query.length);
    onChange(`${before}@${memberLabel(member)} ${after}`);
    if (!mentionedUserIds.includes(member.userId)) {
      onMentionedUserIdsChange([...mentionedUserIds, member.userId]);
    }
    setMentionState(null);
  }

  function handleRemoveMention(userId: string) {
    onMentionedUserIdsChange(mentionedUserIds.filter((id) => id !== userId));
  }

  const mentionedMembers = members.filter((m) => mentionedUserIds.includes(m.userId));

  return (
    <div className={styles.composer}>
      <div className={styles.composerInputWrap}>
        <textarea
          className={styles.textarea}
          value={value}
          placeholder={placeholder}
          disabled={disabled}
          onChange={handleChange}
          rows={2}
        />
        {mentionState && suggestions.length > 0 ? (
          <div className={styles.mentionDropdown}>
            {suggestions.map((member) => (
              <button
                key={member.id}
                type="button"
                className={styles.mentionOption}
                onClick={() => handlePick(member)}
              >
                <Avatar name={memberLabel(member)} size="xs" />
                {memberLabel(member)}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      {mentionedMembers.length > 0 ? (
        <div className={styles.mentionChips}>
          {mentionedMembers.map((member) => (
            <span key={member.id} className={styles.mentionChip}>
              @{memberLabel(member)}
              <button
                type="button"
                className={styles.mentionChipRemove}
                onClick={() => handleRemoveMention(member.userId)}
                aria-label={`Remove mention of ${memberLabel(member)}`}
              >
                <CloseIcon width={10} height={10} />
              </button>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function CommentRow({
  comment,
  currentUserId,
  canComment,
  canModerate,
  members,
  isEditing,
  editContent,
  editMentions,
  editSubmitting,
  editError,
  onStartEdit,
  onCancelEdit,
  onEditContentChange,
  onEditMentionsChange,
  onSubmitEdit,
  onDelete,
}: {
  comment: Comment;
  currentUserId: string | undefined;
  canComment: boolean;
  canModerate: boolean;
  members: Member[];
  isEditing: boolean;
  editContent: string;
  editMentions: string[];
  editSubmitting: boolean;
  editError: string | null;
  onStartEdit: (comment: Comment) => void;
  onCancelEdit: () => void;
  onEditContentChange: (value: string) => void;
  onEditMentionsChange: (ids: string[]) => void;
  onSubmitEdit: (comment: Comment) => void;
  onDelete: (comment: Comment) => void;
}) {
  const isOwn = comment.authorId === currentUserId;

  if (isEditing) {
    return (
      <div className={styles.commentBody}>
        <MentionComposer
          value={editContent}
          onChange={onEditContentChange}
          mentionedUserIds={editMentions}
          onMentionedUserIdsChange={onEditMentionsChange}
          members={members}
          placeholder="Edit your comment"
          disabled={editSubmitting}
        />
        {editError ? (
          <p className={styles.error} role="alert">
            {editError}
          </p>
        ) : null}
        <div className={styles.rowActions}>
          <Button size="sm" onClick={() => onSubmitEdit(comment)} disabled={editSubmitting}>
            {editSubmitting ? "Saving…" : "Save"}
          </Button>
          <Button size="sm" variant="ghost" onClick={onCancelEdit} disabled={editSubmitting}>
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.commentBody}>
      <Avatar name={comment.authorName ?? "Unknown"} size="sm" />
      <div className={styles.commentMain}>
        <div className={styles.commentMeta}>
          <span className={styles.authorName}>{comment.authorName ?? "Unknown"}</span>
          <span className={styles.timestamp}>
            {formatTimestamp(comment.createdAt)}
            {comment.editedAt ? " · edited" : ""}
          </span>
        </div>
        <p className={styles.commentText}>{comment.content}</p>
        {(isOwn || canModerate) && canComment ? (
          <div className={styles.rowActions}>
            {isOwn ? (
              <button type="button" className={styles.linkButton} onClick={() => onStartEdit(comment)}>
                Edit
              </button>
            ) : null}
            <button
              type="button"
              className={`${styles.linkButton} ${styles.linkButtonDanger}`}
              onClick={() => onDelete(comment)}
            >
              Delete
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function CommentsPanel({
  workspaceId,
  documentId,
  canComment,
  role,
  onClose,
}: {
  workspaceId: string;
  documentId: string;
  canComment: boolean;
  role: string | null;
  onClose: () => void;
}) {
  const { apiFetch, user } = useAuth();
  const { showToast } = useToast();
  const canModerate = canModerateComments((role ?? "VIEWER") as WorkspaceRole);

  const [threads, setThreads] = useState<CommentThread[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [members, setMembers] = useState<Member[]>([]);

  const [rootContent, setRootContent] = useState("");
  const [rootMentions, setRootMentions] = useState<string[]>([]);
  const [rootSubmitting, setRootSubmitting] = useState(false);
  const [rootError, setRootError] = useState<string | null>(null);

  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyContent, setReplyContent] = useState("");
  const [replyMentions, setReplyMentions] = useState<string[]>([]);
  const [replySubmitting, setReplySubmitting] = useState(false);
  const [replyError, setReplyError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [editMentions, setEditMentions] = useState<string[]>([]);
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      listComments(apiFetch, workspaceId, documentId),
      listMembers(apiFetch, workspaceId),
    ])
      .then(([commentList, memberList]) => {
        if (cancelled) return;
        setThreads(commentList);
        setMembers(memberList);
        setLoadError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setLoadError(isApiError(err) ? err.message : "Failed to load comments.");
      });
    return () => {
      cancelled = true;
    };
  }, [apiFetch, workspaceId, documentId, reloadKey]);

  function reload() {
    setReloadKey((k) => k + 1);
  }

  async function handleCreateRoot() {
    if (!rootContent.trim()) return;
    setRootSubmitting(true);
    setRootError(null);
    try {
      await createComment(apiFetch, workspaceId, documentId, {
        content: rootContent.trim(),
        mentionedUserIds: rootMentions,
      });
      setRootContent("");
      setRootMentions([]);
      reload();
      showToast("Comment added");
    } catch (err) {
      setRootError(isApiError(err) ? err.message : "Failed to post comment.");
    } finally {
      setRootSubmitting(false);
    }
  }

  function startReply(threadId: string) {
    setReplyingTo(threadId);
    setReplyContent("");
    setReplyMentions([]);
    setReplyError(null);
  }

  function cancelReply() {
    setReplyingTo(null);
    setReplyContent("");
    setReplyMentions([]);
    setReplyError(null);
  }

  async function submitReply(threadId: string) {
    if (!replyContent.trim()) return;
    setReplySubmitting(true);
    setReplyError(null);
    try {
      await createComment(apiFetch, workspaceId, documentId, {
        content: replyContent.trim(),
        parentCommentId: threadId,
        mentionedUserIds: replyMentions,
      });
      cancelReply();
      reload();
      showToast("Reply added");
    } catch (err) {
      setReplyError(isApiError(err) ? err.message : "Failed to post reply.");
    } finally {
      setReplySubmitting(false);
    }
  }

  function startEdit(comment: Comment) {
    setEditingId(comment.id);
    setEditContent(comment.content);
    setEditMentions(comment.mentionedUserIds);
    setEditError(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditContent("");
    setEditMentions([]);
    setEditError(null);
  }

  async function submitEdit(comment: Comment) {
    if (!editContent.trim()) return;
    setEditSubmitting(true);
    setEditError(null);
    try {
      await updateComment(apiFetch, workspaceId, documentId, comment.id, {
        content: editContent.trim(),
        mentionedUserIds: editMentions,
      });
      cancelEdit();
      reload();
    } catch (err) {
      setEditError(isApiError(err) ? err.message : "Failed to save changes.");
    } finally {
      setEditSubmitting(false);
    }
  }

  async function handleDelete(comment: Comment) {
    setActionError(null);
    try {
      await deleteComment(apiFetch, workspaceId, documentId, comment.id);
      reload();
    } catch (err) {
      setActionError(isApiError(err) ? err.message : "Failed to delete comment.");
    }
  }

  async function handleResolve(thread: CommentThread) {
    setActionError(null);
    try {
      await resolveComment(apiFetch, workspaceId, documentId, thread.id);
      reload();
    } catch (err) {
      setActionError(isApiError(err) ? err.message : "Failed to resolve thread.");
    }
  }

  async function handleReopen(thread: CommentThread) {
    setActionError(null);
    try {
      await reopenComment(apiFetch, workspaceId, documentId, thread.id);
      reload();
    } catch (err) {
      setActionError(isApiError(err) ? err.message : "Failed to reopen thread.");
    }
  }

  return (
    <SlideOverPanel title="Comments" onClose={onClose} width={400}>
        {canComment ? (
          <div className={styles.rootComposer}>
            <MentionComposer
              value={rootContent}
              onChange={setRootContent}
              mentionedUserIds={rootMentions}
              onMentionedUserIdsChange={setRootMentions}
              members={members}
              placeholder="Add a comment… use @ to mention someone"
              disabled={rootSubmitting}
            />
            {rootError ? (
              <p className={styles.error} role="alert">
                {rootError}
              </p>
            ) : null}
            <Button
              size="sm"
              className={styles.composerSubmit}
              onClick={handleCreateRoot}
              disabled={rootSubmitting || !rootContent.trim()}
            >
              {rootSubmitting ? "Posting…" : "Comment"}
            </Button>
          </div>
        ) : (
          <p className={styles.hint}>You have read-only access to comments.</p>
        )}

        {actionError ? (
          <p className={styles.error} role="alert">
            {actionError}
          </p>
        ) : null}

        {threads === null ? (
          <Spinner label="Loading comments" />
        ) : loadError ? (
          <p className={styles.error} role="alert">
            {loadError}
          </p>
        ) : threads.length === 0 ? (
          <EmptyState
            icon={<MessageIcon width={20} height={20} />}
            title="No comments yet"
            description={canComment ? "Start the conversation above." : "Nothing has been discussed here yet."}
            compact
          />
        ) : (
          <div className={styles.list}>
            {threads.map((thread) => (
              <div key={thread.id} className={`${styles.thread} ${thread.resolvedAt ? styles.threadResolved : ""}`}>
                {thread.resolvedAt ? (
                  <div className={styles.threadHeader}>
                    <Badge variant="accent">Resolved</Badge>
                  </div>
                ) : null}
                <CommentRow
                  comment={thread}
                  currentUserId={user?.id}
                  canComment={canComment}
                  canModerate={canModerate}
                  members={members}
                  isEditing={editingId === thread.id}
                  editContent={editContent}
                  editMentions={editMentions}
                  editSubmitting={editSubmitting}
                  editError={editError}
                  onStartEdit={startEdit}
                  onCancelEdit={cancelEdit}
                  onEditContentChange={setEditContent}
                  onEditMentionsChange={setEditMentions}
                  onSubmitEdit={submitEdit}
                  onDelete={handleDelete}
                />

                {canComment ? (
                  <div className={styles.threadActions}>
                    <button
                      type="button"
                      className={styles.linkButton}
                      onClick={() => startReply(thread.id)}
                    >
                      Reply
                    </button>
                    {thread.resolvedAt ? (
                      <button
                        type="button"
                        className={styles.linkButton}
                        onClick={() => handleReopen(thread)}
                      >
                        Reopen
                      </button>
                    ) : (
                      <button
                        type="button"
                        className={styles.linkButton}
                        onClick={() => handleResolve(thread)}
                      >
                        Resolve
                      </button>
                    )}
                  </div>
                ) : null}

                {thread.replies.length > 0 ? (
                  <div className={styles.replies}>
                    {thread.replies.map((reply) => (
                      <CommentRow
                        key={reply.id}
                        comment={reply}
                        currentUserId={user?.id}
                        canComment={canComment}
                        canModerate={canModerate}
                        members={members}
                        isEditing={editingId === reply.id}
                        editContent={editContent}
                        editMentions={editMentions}
                        editSubmitting={editSubmitting}
                        editError={editError}
                        onStartEdit={startEdit}
                        onCancelEdit={cancelEdit}
                        onEditContentChange={setEditContent}
                        onEditMentionsChange={setEditMentions}
                        onSubmitEdit={submitEdit}
                        onDelete={handleDelete}
                      />
                    ))}
                  </div>
                ) : null}

                {replyingTo === thread.id ? (
                  <div className={styles.replyComposer}>
                    <MentionComposer
                      value={replyContent}
                      onChange={setReplyContent}
                      mentionedUserIds={replyMentions}
                      onMentionedUserIdsChange={setReplyMentions}
                      members={members}
                      placeholder="Write a reply…"
                      disabled={replySubmitting}
                    />
                    {replyError ? (
                      <p className={styles.error} role="alert">
                        {replyError}
                      </p>
                    ) : null}
                    <div className={styles.rowActions}>
                      <Button size="sm" onClick={() => submitReply(thread.id)} disabled={replySubmitting}>
                        {replySubmitting ? "Posting…" : "Reply"}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={cancelReply} disabled={replySubmitting}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
    </SlideOverPanel>
  );
}
