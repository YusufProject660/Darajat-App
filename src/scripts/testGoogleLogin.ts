import axios from "axios";

const TEST_BACKEND_URL = "http://localhost:5000/api/auth/google";

// Fake ID token for local testing
const fakeIdToken = "eyJhbGciOiJSUzI1NiIsImtpZCI6IjkyN2I4ZmI2N2JiYWQ3NzQ0NWU1ZmVhNGM3MWFhOTg0NmQ3ZGRkMDEiLCJ0eXAiOiJKV1QifQ.eyJpc3MiOiJodHRwczovL2FjY291bnRzLmdvb2dsZS5jb20iLCJhenAiOiI0MDc0MDg3MTgxOTIuYXBwcy5nb29nbGV1c2VyY29udGVudC5jb20iLCJhdWQiOiI0MDc0MDg3MTgxOTIuYXBwcy5nb29nbGV1c2VyY29udGVudC5jb20iLCJzdWIiOiIxMDI4ODk2OTU2ODY5NTc3OTI5MDYiLCJlbWFpbCI6InVpYy4xOGJjYTEyMzFAZ21haWwuY29tIiwiZW1haWxfdmVyaWZpZWQiOnRydWUsImF0X2hhc2giOiJDR2ZnUkxfLUxFeWotUEQ1S3g1MUdnIiwiaWF0IjoxNzU5MzE0ODI3LCJleHAiOjE3NTkzMTg0Mjd9.CxbaeThau5shsxhT9RTquYd7d8bZ3S6Ad9pzarlODLTLxBqWrdW1w9Ybfm467N7vmjHPBxs4ms2K-1iAJkVpgiCV0QEMq_mIYFkkgZ9gTcqXiWAyeKqNTYqaXNi-bIPj9WQwCuhZD9OofrtEltAF2yqNAxB8IYu4Zd40kas28VFKvRW_No76LBMCLoN60j_HiQQa2txJS3RYCh2RGLz6_qS5JkWrCYS0mB6DD9Mx-x11k2H3XY_KlZ-Cr5KbSP8VCDepuQRlx4X_J4FYeROiR3RADGvaZaViTH45ll8C3JbS1lmp0ADLEQlQmAccyrEakCWZxPBGd1xqj3nMU9D5pA";

async function testGoogleLogin() {
  try {
    const response = await axios.post(TEST_BACKEND_URL, {
      idToken: fakeIdToken
    });
    console.log("✅ Response:", response.data);
  } catch (err: any) {
    console.error("❌ Request failed");

    // Axios HTTP error
    if (err.response) {
      console.error("Status:", err.response.status);
      console.error("Data:", err.response.data);
    } 
    // Other error
    else if (err.request) {
      console.error("No response received:", err.request);
    } else {
      console.error("Error message:", err.message);
    }

    console.error("Full error object:", err);
  }
}

testGoogleLogin();
