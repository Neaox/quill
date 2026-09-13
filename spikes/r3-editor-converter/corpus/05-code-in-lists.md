# Code inside lists

Source: written for this spike, in the shape of an installation guide.

1. Install the dependencies:

   ```bash
   pnpm install
   ```

2. Copy the environment file:

   ```bash
   cp .env.example .env
   ```

3. Start the stack:

   ```bash
   docker compose up -d
   pnpm dev
   ```

   The server listens on `:3000` and the web app on `:5173`.

4. Verify with a request:

   ```http
   GET /healthz HTTP/1.1
   Host: localhost:3000
   ```

Nested code inside a nested list:

- Server
  - Start it:

    ```ts
    import { createServer } from './server.ts';

    const server = createServer();
    await server.listen({ port: 3000 });
    ```

  - Stop it with `Ctrl+C`.

A blockquote containing a code block:

> Run this first:
>
> ```sh
> pnpm exec playwright install
> ```
