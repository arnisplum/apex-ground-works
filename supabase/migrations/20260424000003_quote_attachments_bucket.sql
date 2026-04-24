-- Create the private storage bucket for Smart Quote attachments.
-- Anon users may upload files (public cannot list or read).
-- The Edge Function (service role) reads files via signed URLs.

insert into storage.buckets (id, name, public, file_size_limit)
values ('quote-attachments', 'quote-attachments', false, 52428800)
on conflict (id) do nothing;

-- Allow anonymous users to upload into this bucket only.
drop policy if exists "Anon upload quote attachments" on storage.objects;
create policy "Anon upload quote attachments"
  on storage.objects for insert
  to anon
  with check (bucket_id = 'quote-attachments');
