"use client";

import { useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  Plus,
  Trash2,
  Save,
  ChevronDown,
  ChevronUp,
  GripVertical,
} from "lucide-react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

const DOW_LABELS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

type Post = {
  id: string;
  name: string;
  shiftHours: number;
  staffRequired: number;
  staffRequiredDay: number | null;
  staffRequiredNight: number | null;
  modality: string;
  weekdayActive: boolean;
  weekendActive: boolean;
  activeWeekdays: number[];
  specificDays: number[];
  sortOrder: number;
};

interface Props {
  initialPosts: Post[];
}

export function PostManager({ initialPosts }: Props) {
  const router = useRouter();
  const [posts, setPosts] = useState(initialPosts);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [newName, setNewName] = useState("");

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  async function savePost(post: Post) {
    const res = await fetch("/api/admin/posts", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(post),
    });
    if (res.ok) {
      toast.success(`${post.name} сохранён`);
      router.refresh();
    } else {
      toast.error("Ошибка сохранения");
    }
  }

  async function addPost() {
    if (!newName.trim()) {
      toast.error("Укажите название");
      return;
    }
    const res = await fetch("/api/admin/posts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName.trim() }),
    });
    if (res.ok) {
      const p = await res.json();
      setPosts((prev) => [...prev, p]);
      setNewName("");
      toast.success("Аппарат добавлен");
    } else {
      toast.error("Ошибка добавления");
    }
  }

  async function deletePost(id: string) {
    const res = await fetch(`/api/admin/posts?id=${id}`, { method: "DELETE" });
    if (res.ok) {
      setPosts((prev) => prev.filter((p) => p.id !== id));
      toast.success("Аппарат удалён");
    }
  }

  function updateLocal(id: string, updates: Partial<Post>) {
    setPosts((prev) =>
      prev.map((p) => (p.id === id ? { ...p, ...updates } : p))
    );
  }

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = posts.findIndex((p) => p.id === active.id);
    const newIndex = posts.findIndex((p) => p.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const reordered = arrayMove(posts, oldIndex, newIndex);
    setPosts(reordered);

    const res = await fetch("/api/admin/posts", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ order: reordered.map((p) => p.id) }),
    });
    if (!res.ok) {
      toast.error("Не удалось сохранить порядок");
      setPosts(posts);
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Аппараты / Посты</h1>

      <Card>
        <CardContent className="flex gap-2 items-end py-3 px-4 flex-wrap">
          <div className="space-y-1">
            <Label className="text-xs">Название</Label>
            <Input
              placeholder="КТ Новый"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") addPost();
              }}
              className="w-48"
            />
          </div>
          <Button onClick={addPost} size="sm">
            <Plus className="h-4 w-4 mr-1" />
            Добавить
          </Button>
        </CardContent>
      </Card>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={posts.map((p) => p.id)}
          strategy={verticalListSortingStrategy}
        >
          <div className="space-y-2">
            {posts.map((post) => (
              <SortablePostCard
                key={post.id}
                post={post}
                expanded={expandedId === post.id}
                onToggle={() =>
                  setExpandedId(expandedId === post.id ? null : post.id)
                }
                onUpdate={(updates) => updateLocal(post.id, updates)}
                onSave={() => savePost(post)}
                onDelete={() => deletePost(post.id)}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
}

interface SortablePostCardProps {
  post: Post;
  expanded: boolean;
  onToggle: () => void;
  onUpdate: (updates: Partial<Post>) => void;
  onSave: () => void;
  onDelete: () => void;
}

function SortablePostCard({
  post,
  expanded,
  onToggle,
  onUpdate,
  onSave,
  onDelete,
}: SortablePostCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: post.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
    zIndex: isDragging ? 10 : undefined,
  };

  return (
    <div ref={setNodeRef} style={style}>
      <Card>
        <div className="flex items-center gap-1 px-2 py-2">
          <button
            type="button"
            className="shrink-0 cursor-grab active:cursor-grabbing touch-none text-muted-foreground hover:text-foreground rounded p-1"
            aria-label="Перетащить"
            {...attributes}
            {...listeners}
          >
            <GripVertical className="h-4 w-4" />
          </button>
          <div
            className="flex items-center justify-between cursor-pointer flex-1 min-w-0"
            onClick={onToggle}
          >
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="text-sm font-medium truncate">{post.name}</span>
              {post.modality && (
                <Badge variant="default" className="text-[10px] shrink-0">
                  {post.modality}
                </Badge>
              )}
              <Badge variant="outline" className="text-[10px] shrink-0">
                {post.shiftHours}ч
              </Badge>
              <Badge variant="secondary" className="text-[10px] shrink-0">
                {post.shiftHours === 24 && post.staffRequiredDay
                  ? `${post.staffRequiredDay}д/${post.staffRequiredNight ?? post.staffRequired}н`
                  : `${post.staffRequired} чел`}
              </Badge>
            </div>
            {expanded ? (
              <ChevronUp className="h-3.5 w-3.5 shrink-0" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5 shrink-0" />
            )}
          </div>
        </div>
        {expanded && (
          <CardContent className="space-y-4 pt-0">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-1.5">
                <Label>Название</Label>
                <Input
                  value={post.name}
                  onChange={(e) => onUpdate({ name: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Модальность</Label>
                <Select
                  value={post.modality || "none"}
                  onValueChange={(v) =>
                    v && onUpdate({ modality: v === "none" ? "" : v })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">—</SelectItem>
                    <SelectItem value="КТ">КТ</SelectItem>
                    <SelectItem value="МРТ">МРТ</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Смена (ч)</Label>
                <Select
                  value={String(post.shiftHours)}
                  onValueChange={(v) =>
                    v && onUpdate({ shiftHours: parseInt(v) })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="12">12</SelectItem>
                    <SelectItem value="24">24</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Людей на смену</Label>
                <Input
                  type="number"
                  min={1}
                  max={5}
                  value={post.staffRequired}
                  onChange={(e) =>
                    onUpdate({ staffRequired: parseInt(e.target.value) || 1 })
                  }
                />
              </div>
            </div>
            {post.shiftHours === 24 && (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Людей днём</Label>
                  <Input
                    type="number"
                    min={1}
                    max={10}
                    value={post.staffRequiredDay ?? post.staffRequired}
                    onChange={(e) =>
                      onUpdate({
                        staffRequiredDay: parseInt(e.target.value) || null,
                      })
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Людей ночью</Label>
                  <Input
                    type="number"
                    min={1}
                    max={10}
                    value={post.staffRequiredNight ?? post.staffRequired}
                    onChange={(e) =>
                      onUpdate({
                        staffRequiredNight: parseInt(e.target.value) || null,
                      })
                    }
                  />
                </div>
              </div>
            )}
            <div className="space-y-2">
              <Label className="text-xs">Рабочие дни недели</Label>
              <div className="flex gap-1">
                {DOW_LABELS.map((label, i) => {
                  const active = post.activeWeekdays.includes(i);
                  return (
                    <button
                      key={i}
                      onClick={() => {
                        const next = active
                          ? post.activeWeekdays.filter((d) => d !== i)
                          : [...post.activeWeekdays, i].sort();
                        onUpdate({ activeWeekdays: next });
                      }}
                      className={`w-9 h-7 rounded text-xs font-medium transition-colors ${
                        active
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted/50 text-muted-foreground hover:bg-muted"
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
            <PostCalendar
              specificDays={post.specificDays}
              onChange={(days) => onUpdate({ specificDays: days })}
            />
            <div className="flex items-center gap-2 pt-2">
              <Button size="sm" onClick={onSave}>
                <Save className="h-3.5 w-3.5 mr-1" />
                Сохранить
              </Button>
              <Dialog>
                <DialogTrigger
                  className={buttonVariants({
                    size: "sm",
                    variant: "destructive",
                  })}
                >
                  <Trash2 className="h-3.5 w-3.5 mr-1" />
                  Удалить
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Удалить {post.name}?</DialogTitle>
                  </DialogHeader>
                  <p className="text-sm text-muted-foreground">
                    Это действие необратимо.
                  </p>
                  <div className="flex gap-2 justify-end">
                    <Button variant="destructive" onClick={onDelete}>
                      Удалить
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
          </CardContent>
        )}
      </Card>
    </div>
  );
}

function PostCalendar({
  specificDays,
  onChange,
}: {
  specificDays: number[];
  onChange: (days: number[]) => void;
}) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const numDays = new Date(year, month, 0).getDate();
  const firstDow = (new Date(year, month - 1, 1).getDay() + 6) % 7;
  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= numDays; d++) cells.push(d);
  const daySet = new Set(specificDays);

  function toggle(day: number) {
    if (daySet.has(day)) {
      onChange(specificDays.filter((d) => d !== day));
    } else {
      onChange([...specificDays, day].sort((a, b) => a - b));
    }
  }

  const MONTHS = ["Янв","Фев","Мар","Апр","Май","Июн","Июл","Авг","Сен","Окт","Ноя","Дек"];

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2 flex-wrap">
        <Label className="text-xs">Доп. дни (календарь)</Label>
        <div className="flex items-center gap-1 text-xs">
          <button onClick={() => { if (month === 1) { setMonth(12); setYear(year - 1); } else setMonth(month - 1); }} className="px-1 hover:bg-muted rounded">←</button>
          <span className="w-20 text-center font-medium">{MONTHS[month - 1]} {year}</span>
          <button onClick={() => { if (month === 12) { setMonth(1); setYear(year + 1); } else setMonth(month + 1); }} className="px-1 hover:bg-muted rounded">→</button>
        </div>
        {specificDays.length > 0 && (
          <span className="text-[10px] text-muted-foreground">{specificDays.length} дн.</span>
        )}
      </div>
      <p className="text-[10px] text-muted-foreground leading-snug">
        Объединяются с «Рабочими днями недели» (не взаимоисключают). Аппарат работает, если день попадает в рабочие дни недели <em>или</em> отмечен здесь. Удобно, чтобы добавить конкретную дату-исключение (например, приёмы в субботу по графику).
      </p>
      <div className="grid grid-cols-7 gap-px text-center text-[10px] text-muted-foreground">
        {DOW_LABELS.map((d) => <div key={d}>{d}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-0.5">
        {cells.map((day, i) => {
          if (day === null) return <div key={`e-${i}`} className="h-6" />;
          const active = daySet.has(day);
          return (
            <button
              key={day}
              onClick={() => toggle(day)}
              className={`h-6 rounded text-[11px] font-medium transition-colors ${
                active
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted/30 hover:bg-muted"
              }`}
            >
              {day}
            </button>
          );
        })}
      </div>
    </div>
  );
}
