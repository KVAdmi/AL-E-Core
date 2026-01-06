#!/bin/bash

echo "=========================================="
echo "DEBUG: Email Sync System"
echo "=========================================="
echo ""

echo "1. Cuentas activas:"
ssh -i ~/Downloads/mercado-pago.pem ubuntu@100.27.201.233 << 'ENDSSH'
psql $DATABASE_URL -c "SELECT id, from_email, imap_host, imap_port, created_at FROM email_accounts WHERE owner_user_id IS NOT NULL LIMIT 5;"
ENDSSH

echo ""
echo "2. Folders existentes:"
ssh -i ~/Downloads/mercado-pago.pem ubuntu@100.27.201.233 << 'ENDSSH'
psql $DATABASE_URL -c "SELECT account_id, folder_name, folder_type, imap_path, created_at FROM email_folders ORDER BY created_at DESC LIMIT 10;"
ENDSSH

echo ""
echo "3. Últimos sync logs:"
ssh -i ~/Downloads/mercado-pago.pem ubuntu@100.27.201.233 << 'ENDSSH'
psql $DATABASE_URL -c "SELECT account_id, sync_type, status, messages_fetched, messages_new, errors, created_at FROM email_sync_log ORDER BY created_at DESC LIMIT 10;"
ENDSSH

echo ""
echo "4. Verificar trigger de folders:"
ssh -i ~/Downloads/mercado-pago.pem ubuntu@100.27.201.233 << 'ENDSSH'
psql $DATABASE_URL -c "SELECT tgname, tgenabled FROM pg_trigger WHERE tgname = 'trigger_create_default_folders';"
ENDSSH

echo ""
echo "=========================================="
echo "FIN DEBUG"
echo "=========================================="
