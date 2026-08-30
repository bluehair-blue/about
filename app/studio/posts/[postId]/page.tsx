import { notFound } from "next/navigation";

import { DraftEditor } from "../../draft-editor";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async function StudioPostPage({
  params,
}: {
  params: Promise<{ postId: string }>;
}) {
  const { postId } = await params;
  if (!uuidPattern.test(postId)) notFound();
  return <DraftEditor postId={postId} />;
}
