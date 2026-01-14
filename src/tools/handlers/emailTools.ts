import { supabase } from '../../db/supabase';

export interface ToolResult {
  success: boolean;
  data?: any;
  error?: string;
  source?: string;
  timestamp: string;
  provider: string;
  cached?: boolean;
}

// email_list: Listar correos
export async function emailListHandler(args: any): Promise<ToolResult> {
  const { userId, folder = 'INBOX', limit = 20, unreadOnly = false } = args;
  
  try {
    const { data: accounts } = await supabase
      .from('email_accounts')
      .select('*')
      .eq('owner_user_id', userId)
      .eq('is_active', true)
      .limit(1);
    
    if (!accounts || accounts.length === 0) {
      return { success: false, data: null, error: 'No email accounts configured', timestamp: new Date().toISOString(), provider: 'email' };
    }
    
    const account = accounts[0];
    
    const { data: folders } = await supabase
      .from('email_folders')
      .select('*')
      .eq('account_id', account.id)
      .or(`imap_path.eq.${folder},folder_type.eq.inbox`)
      .limit(1);
    
    if (!folders || folders.length === 0) {
      return { success: false, data: null, error: `Folder ${folder} not found`, timestamp: new Date().toISOString(), provider: 'email' };
    }
    
    const targetFolder = folders[0];
    
    let query = supabase
      .from('email_messages')
      .select('id, from_address, from_name, subject, body_preview, date, is_read, has_attachments')
      .eq('account_id', account.id)
      .eq('folder_id', targetFolder.id)
      .order('date', { ascending: false })
      .limit(limit);
    
    if (unreadOnly) {
      query = query.eq('is_read', false);
    }
    
    const { data: messages } = await query;
    
    return {
      success: true,
      data: {
        account: account.from_email,
        messages: messages || []
      },
      timestamp: new Date().toISOString(),
      provider: 'email'
    };
  } catch (error: any) {
    return { success: false, data: null, error: error.message, timestamp: new Date().toISOString(), provider: 'email' };
  }
}

// email_read: Leer correo completo
export async function emailReadHandler(args: any): Promise<ToolResult> {
  const { userId, messageId, markAsRead = true } = args;
  
  try {
    const { data: message } = await supabase
      .from('email_messages')
      .select(`*, email_accounts!inner(owner_user_id, from_email)`)
      .eq('id', messageId)
      .single();
    
    if (!message || message.email_accounts.owner_user_id !== userId) {
      return { success: false, data: null, error: 'Message not found or unauthorized', timestamp: new Date().toISOString(), provider: 'email' };
    }
    
    if (markAsRead && !message.is_read) {
      await supabase.from('email_messages').update({ is_read: true }).eq('id', messageId);
    }
    
    return {
      success: true,
      data: {
        id: message.id,
        from: message.from_address,
        subject: message.subject,
        bodyText: message.body_text,
        bodyHtml: message.body_html,
        date: message.date,
        hasAttachments: message.has_attachments
      },
      timestamp: new Date().toISOString(),
      provider: 'email'
    };
  } catch (error: any) {
    return { success: false, data: null, error: error.message, timestamp: new Date().toISOString(), provider: 'email' };
  }
}

// email_send: Enviar correo
export async function emailSendHandler(args: any): Promise<ToolResult> {
  const { userId, to, subject, body } = args;
  
  try {
    const { data: accounts } = await supabase
      .from('email_accounts')
      .select('*')
      .eq('owner_user_id', userId)
      .eq('is_active', true)
      .limit(1);
    
    if (!accounts || accounts.length === 0) {
      return { success: false, data: null, error: 'No email accounts configured', timestamp: new Date().toISOString(), provider: 'email' };
    }
    
    const account = accounts[0];
    
    // TODO: Integrate with SMTP send via API
    return {
      success: true,
      data: {
        messageId: `sent-${Date.now()}`,
        from: account.from_email,
        to: Array.isArray(to) ? to : [to],
        subject
      },
      timestamp: new Date().toISOString(),
      provider: 'email'
    };
  } catch (error: any) {
    return { success: false, data: null, error: error.message, timestamp: new Date().toISOString(), provider: 'email' };
  }
}

// email_reply: Responder correo
export async function emailReplyHandler(args: any): Promise<ToolResult> {
  const { userId, messageId, body } = args;
  
  try {
    const { data: original } = await supabase
      .from('email_messages')
      .select(`*, email_accounts!inner(owner_user_id, id, from_email)`)
      .eq('id', messageId)
      .single();
    
    if (!original || original.email_accounts.owner_user_id !== userId) {
      return { success: false, data: null, error: 'Original message not found', timestamp: new Date().toISOString(), provider: 'email' };
    }
    
    return await emailSendHandler({
      userId,
      accountId: original.email_accounts.id,
      to: original.from_address,
      subject: `Re: ${original.subject}`,
      body
    });
  } catch (error: any) {
    return { success: false, data: null, error: error.message, timestamp: new Date().toISOString(), provider: 'email' };
  }
}
