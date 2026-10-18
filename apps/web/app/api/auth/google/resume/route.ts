import { NextRequest } from "next/server";
import { resumeGoogleRedirect } from "../bridge";

export const runtime = "nodejs";
export const POST = (request: NextRequest) => resumeGoogleRedirect(request);
