import { NextRequest } from "next/server";
import { clearGoogleRedirect } from "../bridge";

export const runtime = "nodejs";
export const POST = (request: NextRequest) => clearGoogleRedirect(request);
