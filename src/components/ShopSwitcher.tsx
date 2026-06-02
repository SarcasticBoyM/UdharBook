"use client";

import { useEffect, useState } from "react";

type Shop = {
  id: string;
  shopName: string;
};

export function ShopSwitcher({ enabled }: { enabled: boolean }) {
  const [shops, setShops] = useState<Shop[]>([]);
  const [value, setValue] = useState("");

  useEffect(() => {
    if (!enabled) return;
    fetch("/api/shops")
      .then((res) => res.json())
      .then((data) => {
        setShops(data.shops ?? []);
        setValue(data.shops?.[0]?.id ?? "");
      })
      .catch(() => undefined);
  }, [enabled]);

  if (!enabled) return null;

  const switchShop = async (shopId: string) => {
    setValue(shopId);
    await fetch("/api/shops/switch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shopId }),
    });
    window.location.reload();
  };

  return (
    <select
      value={value}
      onChange={(event) => switchShop(event.target.value)}
      className="mt-3 hidden w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-800 md:block"
    >
      {shops.map((shop) => (
        <option key={shop.id} value={shop.id}>
          {shop.shopName}
        </option>
      ))}
    </select>
  );
}
