# Stripe Connect — go-live checklist

Crew → supplier card payments run on Stripe Connect (Express connected
accounts, direct charges, 0.75% platform fee). Everything below is done in
**test mode** today; this is what changes when we flip to **live**.

## Keys & webhooks
- [ ] Swap `STRIPE_SECRET_KEY` (Netlify env) from the test key to the **live**
      secret key.
- [ ] Create a **live-mode** Connect webhook pointing at
      `/.netlify/functions/supplier-payment-webhook` and set its signing secret
      as `STRIPE_CONNECT_WEBHOOK_SECRET` (Netlify env). Subscribe to:
      `account.updated`, `checkout.session.completed`,
      `payment_intent.succeeded`, `payment_intent.payment_failed`,
      `charge.refunded`.
- [ ] Re-onboard each supplier in live mode (test-mode connected accounts do
      not carry over). Supplier `stripe_account_id` / `stripe_charges_enabled`
      reset for live.

## Receipts (the "no receipt" question)
Suppliers are **Express** accounts, so they do **not** get Stripe's receipt
settings screen — for direct charges the receipt uses the connected account's
customer-email/branding settings, which **the platform configures**, not the
supplier. So this is a *platform* action, not a per-supplier one.
- [ ] In the **platform** Stripe Dashboard, enable customer receipt emails for
      connected accounts (Settings → Customer emails / Connect email settings).
      We already pass the payer's `receipt_email` on every PaymentIntent, so
      once this is on and we're live, Stripe emails the card receipt
      automatically.
- Note: Stripe never sends receipt emails in **test mode** — only live
      payments produce a real email. The in-app "Payment sent" receipt
      (order page, on return from Checkout) is what confirms payment during
      testing.

## Commercials / terms
- [ ] Add the 0.75% Cargo platform fee to supplier terms / the connect
      agreement copy.
- [ ] Confirm the base card floor (`platform_payment_config.card_min_amount`,
      currently 50) and fee percent (`fee_percent`, 0.75) for production.
