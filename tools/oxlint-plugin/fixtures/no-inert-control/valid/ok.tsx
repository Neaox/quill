export function OkControls(props: { spreadProps: Record<string, unknown> }) {
  return (
    <>
      <button onClick={() => {}}>Click me</button>
      <Button type="submit">Save</Button>
      <Button disabled>Unavailable</Button>
      <Button loading>Working</Button>
      <Button asChild>Wrapped by a caller that knows better</Button>
      <Button {...props.spreadProps}>Spread</Button>
      <a href="/docs">Docs</a>
      <a {...props.spreadProps}>Spread</a>
      <Link to="/home">Home</Link>
      <Dialog trigger={<Button variant="danger">Discard draft</Button>} />
      <DialogClose>
        <Button variant="secondary">Keep editing</Button>
      </DialogClose>
    </>
  )
}
