# Install for local development or pre-Store testing

1. Clone this repository.
2. Open `chrome://extensions`, enable **Developer mode**, then select
   **Load unpacked**.
3. Choose the repository's `apps/extension` directory.
4. Select the Capacity Monitor toolbar icon. Guided setup opens automatically
   on a fresh installation, or use **Run guided setup** from Settings.

The toolbar popup works independently. The local bridge and dashboard are
optional, advanced components:

- `apps/local-bridge` accepts normalized snapshots and can forward them to a
  user-selected webhook.
- `apps/dashboard` is an optional private dashboard consumer.

Do not copy a real local bridge config, queue, or secret into the repository.
