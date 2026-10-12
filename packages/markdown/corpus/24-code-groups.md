# Code groups

The same request, three ways, as VitePress writes a group:

:::code-group
```ts [TypeScript] title="client.ts"
const response = await fetch('https://api.example.com/v1/documents', {
  headers: { authorization: `Bearer ${token}` },
})
```
```py [Python]
response = requests.get(
    "https://api.example.com/v1/documents",
    headers={"authorization": f"Bearer {token}"},
)
```
```sh [curl]
curl -H "Authorization: Bearer $TOKEN" https://api.example.com/v1/documents
```
:::

As VitePress's own documentation spaces it:

::: code-group
```sh [npm]
npm install quill
```
```sh [pnpm]
pnpm add quill
```
:::

The package manager choice is shared by every group keyed `pkg`:

:::code-group{sync=pkg}

```sh [npm]
npm run build
```

```sh [pnpm]
pnpm build
```

:::

Fumadocs needs no wrapper:

```ts tab="TypeScript"
export const answer = 42
```

```js tab="JavaScript"
export const answer = 42
```

A block can name its file on its own:

```yaml title="quill.config.yaml"
site:
  title: Handbook
```

::::callout{type="note"}
A group inside a callout:

:::code-group
```ts [TypeScript]
render()
```
```py [Python]
render()
```
:::
::::
