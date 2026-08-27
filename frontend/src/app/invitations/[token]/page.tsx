import { InvitationLinkPage } from "@/features/workspaces/InvitationLinkPage";

export default async function InvitationTokenPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <InvitationLinkPage token={token} />;
}
