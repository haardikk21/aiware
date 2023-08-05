import { Prisma, PrismaClient } from "@prisma/client";
import { PromptTemplate } from "langchain/prompts";
import { ConversationalRetrievalQAChain } from "langchain/chains";
import { ChatOpenAI } from "langchain/chat_models/openai";
import { OpenAIEmbeddings } from "langchain/embeddings/openai";
import { PrismaVectorStore } from "langchain/vectorstores/prisma";
import readline from "readline";
import { CallbackManager } from "langchain/callbacks";
import { BufferWindowMemory, ChatMessageHistory } from "langchain/memory";
import { Metadata } from "./types";

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const QA_PROMPT = PromptTemplate.fromTemplate(
  `You are A.I.Ware, a personal AI coding assistant, with expertise in developing modern full-stack apps using Next.JS, TypeScript, Tailwind, and tRPC.
    You are helping a programmer with their code.
    You have been trained on the codebase and understand their codebase in great detail.
    Follow the programmer's requirements carefully and to the letter.
    You should always adhere to technical information.
    Think about your answers step-by-step - and only answer in code that is relevant to the code you have been trained on.
    Use the tools and technologies that are being used in the codebase.
    Follow design patterns from the codebase, such as using tRPC to communicate between the frontend and backend.
    You must answer each question as accurately as possible.
    You must answer each question as if you were a human programmer.
    If you do not know the answer to a question, you must say "I don't know".
    Only answer in code, do not answer in natural language.
    Mention the file names that need modification, or new files that need to be created when answering.

    Q: {question}
    =============
    Context: {context}
    =============
    Answer:
    
    `
);

const chatHistory = new ChatMessageHistory();
const memory = new BufferWindowMemory({
  k: 5,
  chatHistory,
  memoryKey: "chat_history",
  inputKey: "question",
});

export async function runQALoop(m: Metadata) {
  for (;;) {
    const question = await new Promise<string>((resolve) => {
      rl.question('Ask a question (type "exit" to stop): ', (answer) => {
        resolve(answer);
      });
    });

    if (question.toLowerCase() === "exit") {
      rl.close();
      break;
    }

    const sanitizedQuestion = question.trim().replace("\n", " ");

    console.log("You asked: ", sanitizedQuestion);
    const onNewToken = (token: string) => {
      process.stdout.write(token);
    };

    await askQuestion(sanitizedQuestion, onNewToken, m);
    await runQALoop(m);
  }
}

export async function askQuestion(
  question: string,
  onNewToken: (token: string) => void,
  m: Metadata
) {
  const sanitizedQuestion = question.trim().replace("\n", " ");

  const chain = getChatVectorChain(onNewToken, m);
  await chain.call({
    question: sanitizedQuestion,
    chat_history: chatHistory,
  });
}

function getChatVectorChain(onNewToken: (token: string) => void, m: Metadata) {
  const db = new PrismaClient();
  const embeddings = new OpenAIEmbeddings({
    modelName: "text-embedding-ada-002",
  });
  const vectorStore = new PrismaVectorStore(embeddings, {
    db,
    prisma: Prisma,
    tableName: "Document",
    vectorColumnName: "vector",
    columns: {
      id: PrismaVectorStore.IdColumn,
      content: PrismaVectorStore.ContentColumn,
    },
    filter: {
      repoPath: {
        equals: m.repoPath,
      },
    },
  });

  const llm = new ChatOpenAI({
    temperature: 0,
    modelName: "gpt-4",
    maxTokens: -1,
    streaming: true,
    callbackManager: CallbackManager.fromHandlers({
      async handleLLMNewToken(token: string) {
        onNewToken(token);
      },
    }),
  });

  const chain = ConversationalRetrievalQAChain.fromLLM(
    llm,
    vectorStore.asRetriever(),
    {
      qaChainOptions: {
        prompt: QA_PROMPT,
        type: "stuff",
      },
      memory: memory,
    }
  );

  return chain;
}
