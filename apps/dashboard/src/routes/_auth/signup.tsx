import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "../../components/ui/button";
import { Field } from "../../components/ui/field";
import { Form } from "../../components/ui/form";
import { authClient } from "../../lib/auth-client";

export const Route = createFileRoute("/_auth/signup")({
  component: RouteComponent,
});

function RouteComponent() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-medium text-ink">Create an account</h1>
        <p className="text-sm text-ink-dim">We'll set up a workspace for you.</p>
      </div>

      <Form
        onSubmit={async (event) => {
          event.preventDefault();
          setError(null);
          const formData = new FormData(event.currentTarget);
          const name = String(formData.get("name") ?? "");
          const email = String(formData.get("email") ?? "");
          const password = String(formData.get("password") ?? "");

          setLoading(true);
          const { error: signUpError } = await authClient.signUp.email({ name, email, password });
          setLoading(false);

          if (signUpError) {
            setError(signUpError.message ?? "Could not create your account.");
            return;
          }
          navigate({ to: "/" });
        }}
      >
        <Field.Root name="name" className="w-full">
          <Field.Label>Full name</Field.Label>
          <Field.Control required placeholder="Ada Lovelace" />
          <Field.Error match="valueMissing">Enter your name</Field.Error>
        </Field.Root>

        <Field.Root name="email" className="w-full">
          <Field.Label>Email</Field.Label>
          <Field.Control type="email" required placeholder="you@company.com" />
          <Field.Error match="valueMissing">Enter your email</Field.Error>
          <Field.Error match="typeMismatch">Enter a valid email</Field.Error>
        </Field.Root>

        <Field.Root name="password" className="w-full">
          <Field.Label>Password</Field.Label>
          <Field.Control type="password" required minLength={8} placeholder="••••••••" />
          <Field.Error match="valueMissing">Enter a password</Field.Error>
          <Field.Error match="tooShort">Password must be at least 8 characters</Field.Error>
        </Field.Root>

        {error ? <p className="text-sm text-signal-err">{error}</p> : null}

        <Button type="submit" disabled={loading} className="w-full">
          {loading ? "Creating account…" : "Create account"}
        </Button>
      </Form>

      <p className="text-sm text-ink-dim">
        Already have an account?{" "}
        <Link to="/login" className="text-amber hover:underline">
          Log in
        </Link>
      </p>
    </div>
  );
}
