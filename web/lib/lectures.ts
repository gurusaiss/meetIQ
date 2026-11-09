import { notFound } from "next/navigation";
import type { Identity } from "./auth.ts";
import { getService } from "./singletons.ts";
import { isError } from "./http.ts";

/**
 * The approved assets of a lecture, for a page. If the viewer can't reach the
 * lecture's course the service reports it as NotFound (the same answer as for a
 * lecture that doesn't exist, so a non-member can't tell the difference), which
 * becomes the ordinary 404 page here.
 */
export async function releasedAssetsOr404(identity: Identity, lectureId: string) {
  try {
    return await getService().studentAssets(identity.institutionId, lectureId, identity);
  } catch (e) {
    if (isError(e, "NotFoundError")) notFound();
    throw e;
  }
}
