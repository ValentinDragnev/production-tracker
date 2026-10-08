-- Revolut payment link and the contact email shown to customers, both
-- editable in the admin panel. Revolut becomes a payment method.

alter table public.app_settings
  add column revolut_link text not null default ''
    check (revolut_link = '' or revolut_link ~ '^https://[^\s]+$'),
  add column contact_email text not null default ''
    check (contact_email = '' or contact_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$');

update public.app_settings
set revolut_link = 'https://revolut.me/valentwd7c',
    contact_email = 'proizvodstvoibrak@gmail.com';

alter table public.payments drop constraint payments_method_check;
alter table public.payments
  add constraint payments_method_check check (method in ('bank', 'revolut', 'card', 'cash', 'other'));

-- Replaces the 4-argument version with one that also saves the new fields.
drop function public.admin_save_settings(numeric, numeric, text, text);

create function public.admin_save_settings(
  monthly_price numeric,
  yearly_price numeric,
  payment_info_bg text,
  payment_info_en text,
  revolut_link text,
  contact_email text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  update public.app_settings
  set monthly_price = admin_save_settings.monthly_price,
      yearly_price = admin_save_settings.yearly_price,
      payment_info_bg = coalesce(admin_save_settings.payment_info_bg, ''),
      payment_info_en = coalesce(admin_save_settings.payment_info_en, ''),
      revolut_link = trim(coalesce(admin_save_settings.revolut_link, '')),
      contact_email = lower(trim(coalesce(admin_save_settings.contact_email, ''))),
      updated_at = now()
  where id;
end;
$$;

revoke all on function public.admin_save_settings(numeric, numeric, text, text, text, text) from public, anon;
grant execute on function public.admin_save_settings(numeric, numeric, text, text, text, text) to authenticated;
