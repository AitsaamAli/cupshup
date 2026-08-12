import { redirect } from "next/navigation";

/**
 * The app has no standalone home page — staff always land on /login
 * (Part 07) and get routed to their role's default screen from there
 * (defaultRouteForRole(), lib/auth.ts). This route existed as unedited
 * create-next-app boilerplate until Part 15 replaced it.
 */
export default function RootPage() {
  redirect("/login");
}
