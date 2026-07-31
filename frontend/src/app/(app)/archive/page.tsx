import { redirect } from "next/navigation";
import { archiveUrl, defaultArchiveDate } from "@/lib/routes";

export default function ArchiveIndexPage() {
  redirect(archiveUrl(defaultArchiveDate()));
}
