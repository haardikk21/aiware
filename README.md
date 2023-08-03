# A.I.Ware

![](./AIWare%20Demo.gif)

A CLI-based chatbot that fine-tunes itself in real time by learning from your local Git repo. Ask the chatbot about codebase details for faster development and bug fixes, and have it auto-update on each commit.

## Requirements

- Docker
- Node.js

## Workflow

Install dependencies using `pnpm install`

1. Copy `.env.sample` to `.env`
   1.1. Specify `OPENAI_API_KEY` and `DEFAULT_REPO_PATH` in the `.env`
2. Start a new Postgres database locally using `pnpm db:up` which will also install the `pgvector` extension.
3. Run `pnpm db:push` to sync the schema with your database
4. Run `pnpm dev` to start the CLI

Once started:

1. Provide a repo path if different from `DEFAULT_REPO_PATH` - else leave empty
2. If the repo is new, it will embed the codebase into Postgres using OpenAI Embeddings
3. Ask questions about your codebase in the chatbot
4. A.I.Ware will check for new commits to delete old embeddings of changed files and re-embed them periodically so it always has the latest context.

## License

This repo is licensed under the [MIT License](./LICENSE).
