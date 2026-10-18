import { NextRequest } from "next/server";
import { receiveGoogleRedirect } from "../bridge";

export const runtime = "nodejs";
export const POST = (request: NextRequest) => receiveGoogleRedirect(request);
