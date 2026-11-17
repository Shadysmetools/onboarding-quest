// GET /api/activity?k=ADMIN_KEY -> the learner's activity log, last seen, active minutes per day.
import { getActivity, json, roleOf } from "./_lib.mjs";

export async function GET(req) {
  if (roleOf(req) !== "mentor") return json({ error: "unauthorized" }, 401);
  return json(await getActivity());
}
