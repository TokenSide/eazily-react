import { supabase } from '../lib/supabase.js';
import { requireBackend, rpc } from './experience.js';

export const CHAT_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
export const CHAT_SIGNED_URL_SECONDS = 300;
export const CHAT_ATTACHMENT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

export const listChatConversations = (role = null, before = null, limit = 30) =>
  rpc('list_chat_conversations', { p_role: role, p_before: before, p_limit: limit });
export const getChatMessages = (conversationId, before = null, limit = 40) =>
  rpc('get_chat_messages', { p_conversation: conversationId, p_before: before, p_limit: limit });
export const startChat = ({ postId = null, orderId = null, requestId = null, key = crypto.randomUUID() }) =>
  rpc('start_chat', { p_post: postId, p_order: orderId, p_request: requestId, p_key: key });
export const sendChatMessage = ({ conversationId, body, type = 'text', attachmentId = null, replyToId = null, key }) =>
  rpc('send_chat_message', { p_conversation: conversationId, p_body: body || '', p_type: type, p_attachment: attachmentId, p_reply_to: replyToId, p_key: key });
export const markChatRead = (conversationId, messageId) => rpc('mark_chat_read', { p_conversation: conversationId, p_message: messageId });
export const getChatUnreadTotal = role => rpc('get_chat_unread_total', { p_role: role || null });
export const updateChatPreferences = (conversationId, values) => rpc('update_chat_preferences', {
  p_conversation: conversationId, p_archived: values.archived ?? null, p_muted: values.muted ?? null
});
export const setChatBlock = (conversationId, blocked) => rpc('set_chat_block', { p_conversation: conversationId, p_blocked: blocked });
export const reportChat = (conversationId, messageId, reason, details) => rpc('report_chat', {
  p_conversation: conversationId, p_message: messageId || null, p_reason: reason, p_details: details || null
});

function attachmentExtension(file) {
  const known = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' };
  return known[file.type];
}

export async function uploadChatAttachment(conversationId, file, operationKey = crypto.randomUUID()) {
  if (!CHAT_ATTACHMENT_TYPES.includes(file.type)) throw new Error('Choose a JPG, PNG, WebP, or PDF file.');
  if (!file.size || file.size > CHAT_ATTACHMENT_MAX_BYTES) throw new Error('Attachments must be 10 MB or smaller.');
  const database = requireBackend();
  const { data: { user }, error: userError } = await database.auth.getUser();
  if (userError || !user) throw new Error('Sign in to attach a file.');
  const path = `${conversationId}/${user.id}/${operationKey}.${attachmentExtension(file)}`;
  const uploaded = await database.storage.from('chat-attachments').upload(path, file, { contentType: file.type, upsert: false });
  if (uploaded.error && !/already exists|duplicate/i.test(uploaded.error.message)) throw uploaded.error;
  try {
    return await rpc('register_chat_attachment', {
      p_conversation: conversationId, p_path: path, p_name: file.name, p_mime: file.type, p_size: file.size, p_key: operationKey
    });
  } catch (error) {
    if (!uploaded.error) await database.storage.from('chat-attachments').remove([path]);
    throw error;
  }
}

export async function createChatAttachmentUrl(path) {
  if (!supabase || !path) return null;
  const { data, error } = await supabase.storage.from('chat-attachments').createSignedUrl(path, CHAT_SIGNED_URL_SECONDS);
  if (error) throw error;
  return data?.signedUrl || null;
}
