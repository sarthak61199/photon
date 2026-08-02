import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "../../components/ui/button";
import { Field } from "../../components/ui/field";
import { Form } from "../../components/ui/form";
import { authClient } from "../../lib/auth-client";

export const Route = createFileRoute("/_auth/login")({
  component: RouteComponent,
});

function RouteComponent() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-medium text-ink">Log in</h1>
        <p className="text-sm text-ink-dim">Welcome back.</p>
      </div>

      <Form
        onSubmit={async (event) => {
          event.preventDefault();
          setError(null);
          const formData = new FormData(event.currentTarget);
          const email = String(formData.get("email") ?? "");
          const password = String(formData.get("password") ?? "");

          setLoading(true);
          const { error: signInError } = await authClient.signIn.email({ email, password });
          setLoading(false);

          if (signInError) {
            setError(signInError.message ?? "Could not log in.");
            return;
          }
          navigate({ to: "/" });
        }}
      >
        <Field.Root name="email" className="w-full">
          <Field.Label>Email</Field.Label>
          <Field.Control type="email" required placeholder="you@company.com" />
          <Field.Error match="valueMissing">Enter your email</Field.Error>
          <Field.Error match="typeMismatch">Enter a valid email</Field.Error>
        </Field.Root>

        <Field.Root name="password" className="w-full">
          <Field.Label>Password</Field.Label>
          <Field.Control type="password" required minLength={8} placeholder="••••••••" />
          <Field.Error match="valueMissing">Enter your password</Field.Error>
        </Field.Root>

        {error ? <p className="text-sm text-signal-err">{error}</p> : null}

        <Button type="submit" disabled={loading} className="w-full">
          {loading ? "Logging in…" : "Log in"}
        </Button>
      </Form>

      <p className="text-sm text-ink-dim">
        No account?{" "}
        <Link to="/signup" className="text-amber hover:underline">
          Sign up
        </Link>
      </p>
    </div>
  );
}
