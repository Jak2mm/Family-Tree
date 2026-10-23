import { useMe } from "../me";
import { ActivitySection } from "./ActivitySection";
import { BackupSection } from "./BackupSection";
import { Placeholder } from "./Placeholder";
import { UpdatesSection } from "./UpdatesSection";
import { UsersSection } from "./UsersSection";

/** The server checks every one of these requests too; hiding the page here is only a convenience. */
export function AdminSettings() {
  const { can } = useMe();
  if (!can("admin")) return <Placeholder title="Settings">You are not allowed to see this page. Please ask the administrator.</Placeholder>;
  return (
    <div>
      <h1>Settings</h1>
      <UsersSection />
      <BackupSection />
      <UpdatesSection />
      <ActivitySection />
    </div>
  );
}
