# Numisma Project Structure

```bash
numisma/
├── .cursor/
│ └── PRD/
│ ├── README.md
│ └── project-structure.md
├── .storybook/
│ ├── main.ts
│ ├── preview.ts
│ └── vitest.setup.ts
├── .vscode/
│ └── settings.json
├── node_modules/
├── prisma/
│ ├── migrations/
│ └── schema.prisma
├── src/
│ ├── app/
│ │ ├── api/
│ │ │ ├── auth/
│ │ │ │ └── [...nextauth]/
│ │ │ │ └── route.ts
│ │ │ └── trpc/
│ │ │ └── [trpc]/
│ │ │ └── route.ts
│ │ ├── login/
│ │ │ └── page.tsx
│ │ ├── favicon.ico
│ │ ├── globals.css
│ │ ├── layout.tsx
│ │ └── page.tsx
│ ├── components/
│ │ ├── auth/
│ │ │ └── login-card/
│ │ │ ├── login-card.stories.ts
│ │ │ └── login-card.tsx
│ │ ├── providers/
│ │ │ └── session-provider.tsx
│ │ ├── ui/
│ │ │ ├── lib/
│ │ │ │ └── utils.ts
│ │ │ ├── button.tsx
│ │ │ ├── card.tsx
│ │ │ ├── dropdown-menu.tsx
│ │ │ ├── input.tsx
│ │ │ └── label.tsx
│ │ ├── utils/
│ │ │ ├── theme-debug-display.tsx
│ │ │ └── theme-selector.tsx
│ │ ├── sign-out-button.tsx
│ │ └── user-list.tsx
│ ├── db/
│ │ └── prisma-client.ts
│ ├── design-system/
│ │ └── color-system.stories.tsx
│ ├── server/
│ │ └── trpc/
│ │ ├── context.ts
│ │ └── router.ts
│ ├── trpc/
│ │ ├── Provider.tsx
│ │ ├── client.ts
│ │ └── react.ts
│ ├── types/
│ │ └── next-auth.d.ts
│ └── utils/
│ │ ├── auth.ts
│ │ ├── get-base-url.ts
│ │ └── with-auth.ts
├── .gitignore
├── components.json
├── eslint.config.mjs
├── next.config.ts
├── package.json
├── pnpm-lock.yaml
├── postcss.config.mjs
├── README.md
├── tsconfig.json
└── vitest.config.ts
```
