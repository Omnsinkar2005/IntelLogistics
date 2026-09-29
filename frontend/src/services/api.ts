import axios from "axios";

export const api = axios.create({
  baseURL: "/api",
  headers: { "Content-Type": "application/json" },
  timeout: 15000,
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    const message = err.response?.data?.error?.message ?? err.message ?? "Request failed";
    return Promise.reject(new Error(message));
  }
);
