import { NextRequest } from "next/server";
import { prepareGoogleRedirect } from "../bridge";

export const runtime = "nodejs";
export const POST = (request: NextRequest) => prepareGoogleRedirect(request);
